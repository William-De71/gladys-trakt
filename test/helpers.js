// Shared test doubles: a fake Trakt (a `fetch` answering from tables, shaped
// like the official API documented on developer.trakt.tv), a state file in a
// temporary folder and a clock the tests move by hand. Nothing here touches
// the network.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStore } from '../src/store.js';

export const TZ = 'Europe/Paris';
export const CLIENT_ID = 'c'.repeat(64);

// A 1×1 PNG.
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

const SEVERANCE = {
  title: 'Severance',
  year: 2022,
  ids: { trakt: 154997, slug: 'severance', imdb: 'tt11280740', tmdb: 95396 },
  network: 'Apple TV+',
  runtime: 50,
  images: { poster: ['walter-r2.trakt.tv/images/shows/000/154/997/posters/thumb/a1.jpg.webp'] },
};
const ANDOR = {
  title: 'Andor',
  year: 2022,
  ids: { trakt: 150456, slug: 'andor', imdb: 'tt9253284', tmdb: 83867 },
  network: 'Disney+',
  runtime: 45,
  images: { poster: ['walter-r2.trakt.tv/images/shows/000/150/456/posters/thumb/b2.jpg.webp'] },
};
export const SHOWS = { SEVERANCE, ANDOR };

/**
 * @description An entry of `/calendars/my/shows`.
 * @param {object} show - A show object.
 * @param {number} season - Season.
 * @param {number} number - Episode number.
 * @param {string} firstAired - UTC instant.
 * @param {object} [extra] - Fields of the episode.
 * @returns {object} The entry.
 */
export function episodeEntry(show, season, number, firstAired, extra = {}) {
  return {
    first_aired: firstAired,
    episode: {
      season,
      number,
      title: `Episode ${number}`,
      ids: { trakt: show.ids.trakt * 1000 + season * 100 + number },
      runtime: show.runtime,
      episode_type: 'standard',
      ...extra,
    },
    show,
  };
}

/**
 * @description An entry of `/calendars/my/movies` or `/streaming`.
 * @param {number} id - Trakt id.
 * @param {string} title - Title.
 * @param {string} released - `YYYY-MM-DD`.
 * @returns {object} The entry.
 */
export function movieEntry(id, title, released) {
  return {
    released,
    movie: {
      title,
      year: Number(released.slice(0, 4)),
      ids: { trakt: id, slug: title.toLowerCase().replace(/\W+/g, '-') },
      runtime: 120,
      images: { poster: [`walter-r2.trakt.tv/images/movies/${id}/posters/thumb/p.jpg.webp`] },
    },
  };
}

/**
 * @description An entry of `/sync/progress/up_next`.
 * @param {object} show - A show object.
 * @param {object} progress - `{ aired, completed, season, number }`.
 * @returns {object} The entry.
 */
export function upNextEntry(show, { aired, completed, season, number }) {
  return {
    show,
    progress: {
      aired,
      completed,
      last_watched_at: '2026-11-10T21:00:00.000Z',
      reset_at: null,
      next_episode: {
        season,
        number,
        title: `Episode ${number}`,
        ids: { trakt: show.ids.trakt * 1000 + season * 100 + number },
        first_aired: '2026-10-01T01:00:00.000Z',
      },
    },
  };
}

const json = (status, body, headers = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/**
 * @description A fake Trakt behind `fetch`.
 * @param {object} [options] - The tables (changed in place by the tests).
 * @returns {object} `{ fetch, calls, state }`.
 */
export function fakeTrakt(options = {}) {
  const state = {
    clientId: CLIENT_ID,
    pending: 0, // device token polls answered 400 before the approval
    deviceAnswer: 200, // status once no longer pending (418 denied, 410 expired)
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    shows: [],
    movies: [],
    streaming: [],
    upNext: [],
    watching: null,
    username: 'jane',
    failures: {}, // path prefix -> status
    watchlist: new Set(),
    history: [],
    search: {},
    tokenCounter: 1,
    ...options,
  };
  const calls = [];

  const authorized = (headers) => headers.Authorization === `Bearer ${state.accessToken}`;

  const inWindow = (list, start, days, field) => {
    const from = Date.parse(`${start}T00:00:00Z`);
    const to = from + days * 86400000;
    return list.filter((entry) => {
      const at = Date.parse(
        field === 'first_aired' ? entry.first_aired : `${entry.released}T00:00:00Z`,
      );
      return at >= from && at < to;
    });
  };

  async function fetchImpl(url, init = {}) {
    const { pathname, searchParams, hostname } = new URL(url);
    const method = init.method ?? 'GET';
    const headers = init.headers ?? {};
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push(`${method} ${hostname === 'api.trakt.tv' ? '' : hostname}${pathname}`);
    if (hostname.endsWith('trakt.tv') && hostname !== 'api.trakt.tv') {
      return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    for (const [prefix, status] of Object.entries(state.failures)) {
      if (pathname.startsWith(prefix)) {
        return json(status, undefined);
      }
    }
    if (headers['trakt-api-key'] !== state.clientId && pathname !== '/oauth/token') {
      return json(403, undefined);
    }
    if (pathname === '/oauth/device/code') {
      if (body.client_id !== state.clientId) {
        return json(401, { error: 'invalid_client', error_description: 'client not found' });
      }
      return json(200, {
        device_code: 'device-1',
        user_code: 'ABCD1234',
        verification_url: 'https://trakt.tv/activate',
        expires_in: 600,
        interval: 5,
      });
    }
    if (pathname === '/oauth/device/token') {
      if (state.pending > 0) {
        state.pending -= 1;
        return json(400, undefined);
      }
      if (state.deviceAnswer !== 200) {
        return json(state.deviceAnswer, undefined);
      }
      return json(200, {
        access_token: state.accessToken,
        refresh_token: state.refreshToken,
        expires_in: 604800,
        token_type: 'bearer',
        scope: 'public',
        created_at: 1,
      });
    }
    if (pathname === '/oauth/token') {
      if (body.refresh_token !== state.refreshToken) {
        return json(400, { error: 'invalid_grant', error_description: 'session not found' });
      }
      state.tokenCounter += 1;
      state.accessToken = `access-${state.tokenCounter}`;
      state.refreshToken = `refresh-${state.tokenCounter}`;
      return json(200, {
        access_token: state.accessToken,
        refresh_token: state.refreshToken,
        expires_in: 604800,
      });
    }
    if (!authorized(headers)) {
      return json(401, undefined);
    }
    const calendar = /^\/calendars\/my\/(shows|movies|streaming)\/(\d{4}-\d{2}-\d{2})\/(\d+)$/.exec(
      pathname,
    );
    if (calendar) {
      const [, kind, start, days] = calendar;
      const list = state[kind];
      return json(
        200,
        inWindow(list, start, Number(days), kind === 'shows' ? 'first_aired' : 'released'),
      );
    }
    if (pathname === '/sync/progress/up_next') {
      return json(200, state.upNext);
    }
    if (pathname === '/users/me/watching') {
      return state.watching ? json(200, state.watching) : json(204, undefined);
    }
    if (pathname === '/users/settings') {
      return json(200, {
        user: { username: state.username, vip: false, ids: { slug: state.username } },
      });
    }
    const search = /^\/search\/(movie|show)$/.exec(pathname);
    if (search) {
      return json(200, state.search[searchParams.get('query')] ?? []);
    }
    if (pathname.startsWith('/search/imdb/')) {
      return json(200, state.search[pathname.slice('/search/imdb/'.length)] ?? []);
    }
    if (pathname === '/sync/watchlist') {
      const [type] = Object.keys(body);
      const id = body[type][0].ids.trakt ?? body[type][0].ids.slug;
      const key = `${type}:${id}`;
      const existing = state.watchlist.has(key);
      state.watchlist.add(key);
      const counts = { movies: 0, shows: 0, seasons: 0, episodes: 0 };
      return json(201, {
        added: { ...counts, [type]: existing ? 0 : 1 },
        existing: { ...counts, [type]: existing ? 1 : 0 },
        not_found: { movies: [], shows: [] },
      });
    }
    if (pathname === '/sync/history') {
      state.history.push(body);
      const [type] = Object.keys(body);
      return json(201, { added: { movies: 0, episodes: 0, [type]: 1 }, not_found: {} });
    }
    return json(404, undefined);
  }

  return { fetch: fetchImpl, calls, state };
}

/**
 * @description A store in a fresh temporary folder.
 * @returns {{ store: object, path: string, dir: string, cleanup: Function }} The store.
 */
export function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'trakt-test-'));
  const path = join(dir, 'state.json');
  return {
    store: createStore({ path, flushDelay: 0 }),
    path,
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * @description A clock moved by hand.
 * @param {string} iso - Start instant.
 * @returns {{ now: Function, set: Function, advance: Function }} The clock.
 */
export function fakeClock(iso) {
  let current = Date.parse(iso);
  return {
    now: () => current,
    set: (value) => {
      current = Date.parse(value);
    },
    advance: (ms) => {
      current += ms;
    },
  };
}

export const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
