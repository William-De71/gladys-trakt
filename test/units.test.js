// The parts on their own: the sign-in, the HTTP client, the items, the
// posters, the configuration. A fake Trakt behind `fetch`; no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  AuthError,
  createTokenManager,
  readTokens,
  requestDeviceCode,
  waitForApproval,
} from '../src/auth.js';
import { normalizeConfig } from '../src/config.js';
import { imageKeyOf, isTraktImage, createImages } from '../src/images.js';
import {
  calendarChunks,
  dayOf,
  episodeCode,
  fullTitle,
  itemUrl,
  posterOf,
  timeOf,
  toEpisodeItems,
  toMovieItems,
  upcomingItems,
} from '../src/items.js';
import { createTraktClient } from '../src/trakt.js';
import { toWatching } from '../src/watching.js';
import {
  CLIENT_ID,
  PNG,
  SHOWS,
  TZ,
  episodeEntry,
  fakeClock,
  fakeTrakt,
  movieEntry,
  tempStore,
} from './helpers.js';

const UA = 'gladys-trakt/test';
const noSleep = async () => {};

test('device code: asks with the Client ID alone, keeps only a trakt.tv page', async () => {
  const trakt = fakeTrakt();
  const code = await requestDeviceCode({
    clientId: CLIENT_ID,
    fetchImpl: trakt.fetch,
    userAgent: UA,
  });
  assert.deepEqual(code, {
    deviceCode: 'device-1',
    userCode: 'ABCD1234',
    verificationUrl: 'https://trakt.tv/activate',
    interval: 5,
    expiresIn: 600,
  });
  await assert.rejects(
    requestDeviceCode({ clientId: 'wrong', fetchImpl: trakt.fetch, userAgent: UA }),
    (error) => error instanceof AuthError && error.code === 'invalid_client',
  );
  const evil = async () =>
    new Response(
      JSON.stringify({
        device_code: 'd',
        user_code: 'u',
        verification_url: 'https://evil.example/',
      }),
      { status: 200 },
    );
  await assert.rejects(
    requestDeviceCode({ clientId: CLIENT_ID, fetchImpl: evil }),
    /activation page/,
  );
});

test('approval: pending (400), slow down (429), denied (418), expired (410)', async () => {
  const code = { deviceCode: 'device-1', interval: 5, expiresIn: 600 };
  const trakt = fakeTrakt({ pending: 3 });
  const tokens = await waitForApproval({
    clientId: CLIENT_ID,
    code,
    fetchImpl: trakt.fetch,
    sleep: noSleep,
    now: () => 0,
  });
  assert.equal(tokens.accessToken, 'access-1');
  assert.equal(tokens.expiresAt, 604800 * 1000);
  assert.equal(trakt.calls.filter((call) => call.endsWith('/oauth/device/token')).length, 4);

  const waits = [];
  let slow = 1;
  const slowDown = async () =>
    slow-- > 0
      ? new Response(null, { status: 429 })
      : new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r' }), { status: 200 });
  await waitForApproval({
    clientId: CLIENT_ID,
    code,
    fetchImpl: slowDown,
    sleep: async (ms) => waits.push(ms),
    now: () => 0,
  });
  assert.deepEqual(waits, [5000, 6000]);

  for (const [status, expected] of [
    [418, 'denied'],
    [410, 'expired'],
    [409, 'used'],
  ]) {
    const answer = async () => new Response(null, { status });
    await assert.rejects(
      waitForApproval({
        clientId: CLIENT_ID,
        code,
        fetchImpl: answer,
        sleep: noSleep,
        now: () => 0,
      }),
      (error) => error.code === expected,
      String(status),
    );
  }
  assert.throws(() => readTokens({ access_token: 'only' }, 0), /no token/);
});

test('tokens: one refresh for every caller, stored before use; a dead one asks to connect', async () => {
  const trakt = fakeTrakt();
  const clock = fakeClock('2026-11-14T08:00:00Z');
  const saved = [];
  const manager = createTokenManager({
    getClientId: () => CLIENT_ID,
    saveTokens: async (tokens) => saved.push(tokens.refreshToken),
    fetchImpl: trakt.fetch,
    now: clock.now,
  });
  manager.setTokens({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: clock.now() + 1000,
  });
  assert.equal(manager.dueForRefresh(), true);
  const [a, b] = await Promise.all([manager.getAccessToken(), manager.getAccessToken()]);
  assert.deepEqual([a, b], ['access-2', 'access-2']);
  assert.deepEqual(saved, ['refresh-2']);
  // The refresh token was single-use: refresh-1 is dead now.
  manager.setTokens({ accessToken: 'x', refreshToken: 'refresh-1', expiresAt: 0 });
  await assert.rejects(manager.refresh(), (error) => error.reauth === true);
});

test('client: required headers, one retry after a refreshed token, 429 pauses everything', async () => {
  const trakt = fakeTrakt({ accessToken: 'access-2', refreshToken: 'refresh-1', tokenCounter: 1 });
  const clock = fakeClock('2026-11-14T08:00:00Z');
  const tokens = createTokenManager({
    getClientId: () => CLIENT_ID,
    saveTokens: async () => {},
    fetchImpl: trakt.fetch,
    now: clock.now,
  });
  tokens.setTokens({
    accessToken: 'stale',
    refreshToken: 'refresh-1',
    expiresAt: clock.now() + 1e9,
  });
  const seen = [];
  const spy = async (url, init) => {
    seen.push(init.headers);
    return trakt.fetch(url, init);
  };
  const client = createTraktClient({
    tokens,
    getClientId: () => CLIENT_ID,
    fetchImpl: spy,
    userAgent: UA,
    now: clock.now,
    sleep: noSleep,
  });
  assert.equal(await client.watching(), null, '204: nothing plays');
  assert.equal(seen[0]['trakt-api-key'], CLIENT_ID);
  assert.equal(seen[0]['trakt-api-version'], '2');
  assert.equal(seen[0]['User-Agent'], UA);
  assert.equal(seen.at(-1).Authorization, 'Bearer access-2');

  let limited = true;
  const rate = async (url, init) =>
    limited
      ? new Response(null, { status: 429, headers: { 'retry-after': '120' } })
      : trakt.fetch(url, init);
  const paused = createTraktClient({
    tokens,
    getClientId: () => CLIENT_ID,
    fetchImpl: rate,
    now: clock.now,
    sleep: noSleep,
  });
  await assert.rejects(paused.settings(), (error) => error.kind === 'rate');
  limited = false;
  assert.equal(paused.pausedUntil, clock.now() + 120000);
  await assert.rejects(paused.settings(), (error) => error.kind === 'rate', 'still paused');
  clock.advance(121000);
  assert.equal((await paused.settings()).user.username, 'jane');

  for (const [status, kind] of [
    [403, 'forbidden'],
    [420, 'limit'],
    [426, 'vip'],
    [502, 'server'],
  ]) {
    const answer = async () => new Response(null, { status });
    const failing = createTraktClient({
      tokens,
      getClientId: () => CLIENT_ID,
      fetchImpl: answer,
      now: clock.now,
      sleep: noSleep,
    });
    await assert.rejects(failing.settings(), (error) => error.kind === kind, String(status));
  }
});

test('items: episodes grouped per show and instant, specials left out, movies by date', () => {
  const raw = [
    episodeEntry(SHOWS.ANDOR, 2, 2, '2026-11-21T08:00:00.000Z'),
    episodeEntry(SHOWS.ANDOR, 2, 1, '2026-11-21T08:00:00.000Z', {
      episode_type: 'season_premiere',
    }),
    episodeEntry(SHOWS.SEVERANCE, 2, 5, '2026-11-18T02:00:00.000Z', { title: 'Trojan’s Horse' }),
    episodeEntry(SHOWS.SEVERANCE, 0, 1, '2026-11-16T02:00:00.000Z'),
    { first_aired: 'nope', episode: { season: 1, number: 1 }, show: SHOWS.ANDOR },
  ];
  const items = toEpisodeItems(raw);
  assert.deepEqual(
    items.map((item) => [item.id, episodeCode(item), item.count, item.episodeType]),
    [
      ['ep-150456-2-1', 'S02E01–E02', 2, 'season_premiere'],
      ['ep-154997-2-5', 'S02E05', 1, 'standard'],
    ],
  );
  assert.equal(toEpisodeItems(raw, { specials: true }).length, 3);
  const severance = items[1];
  assert.equal(fullTitle(severance), 'Severance S02E05 – Trojan’s Horse');
  assert.equal(itemUrl(severance), 'https://trakt.tv/shows/severance/seasons/2/episodes/5');
  // 02:00 UTC is 03:00 in Paris, 21:00 the day before in New York.
  assert.deepEqual([dayOf(severance, TZ), timeOf(severance, TZ)], ['2026-11-18', '03:00']);
  assert.deepEqual(
    [dayOf(severance, 'America/New_York'), timeOf(severance, 'America/New_York')],
    ['2026-11-17', '21:00'],
  );
  assert.equal(
    episodeCode({ season: 1, number: 10, count: 2, lastSeason: 2, lastNumber: 1 }),
    'S01E10–S02E01',
  );
  assert.equal(severance.poster.startsWith('https://walter-r2.trakt.tv/'), true);
  assert.equal(posterOf({ poster: [] }), '');

  const movies = toMovieItems(
    [
      movieEntry(501, 'Dune: Part Three', '2026-12-18'),
      { released: '2026', movie: { ids: { trakt: 1 } } },
    ],
    'streaming',
  );
  assert.deepEqual(
    movies.map((movie) => [movie.id, movie.date, itemUrl(movie)]),
    [['st-501', '2026-12-18', 'https://trakt.tv/movies/dune-part-three']],
  );
  assert.deepEqual(
    upcomingItems([...items, ...movies], { today: '2026-11-19', timeZone: TZ, title: 'andor' }).map(
      (item) => item.id,
    ),
    ['ep-150456-2-1'],
  );
});

test('calendar chunks: 33 days at most per request, a day of margin on each side', () => {
  assert.deepEqual(calendarChunks('2026-11-14', { back: 7, ahead: 30 }), [
    { start: '2026-11-06', days: 33 },
    { start: '2026-12-09', days: 7 },
  ]);
});

test('now watching: a movie or an episode, nothing for anything else', () => {
  const movie = toWatching({
    type: 'movie',
    started_at: '2026-11-14T20:00:00Z',
    expires_at: '2026-11-14T22:00:00Z',
    movie: { title: 'Dune', year: 2021, ids: { trakt: 8, slug: 'dune-2021' } },
  });
  assert.deepEqual([movie.key, movie.kind, movie.title], ['movie-8', 'movie', 'Dune']);
  assert.equal(toWatching(null), null);
  assert.equal(toWatching({ type: 'episode', episode: {} }), null);
});

test('posters: cached on disk from trakt.tv only, served by key, forgotten when unused', async () => {
  const { store, dir, cleanup } = tempStore();
  try {
    const clock = fakeClock('2026-11-14T08:00:00Z');
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return url.includes('broken')
        ? new Response('<html>', { status: 200 })
        : new Response(PNG, { status: 200 });
    };
    const images = createImages({ store, fetch: fetchImpl, now: clock.now, sleep: noSleep });
    const url = 'https://walter-r2.trakt.tv/images/shows/1/posters/thumb/a.jpg.webp';
    const broken = 'https://walter-r2.trakt.tv/images/shows/2/posters/thumb/broken.webp';
    assert.equal(images.keyIfReady(url), null, 'not cached yet');
    assert.equal(await images.cache([url, broken, 'https://evil.example/x.png']), true);
    assert.deepEqual(calls, [url, broken]);
    const key = images.keyIfReady(url);
    assert.equal(key, imageKeyOf(url));
    assert.equal(images.keyIfReady(broken), null);
    assert.ok(existsSync(join(dir, 'posters', key)));
    assert.equal(await images.get(key), PNG.toString('base64'));
    await assert.rejects(images.get('tk-0000000000000000'), /unknown image/);
    // A day later the broken one is asked again; a month later both are forgotten.
    clock.advance(31 * 24 * 3600 * 1000);
    await images.cache([]);
    assert.equal(images.keyIfReady(url), null);
    assert.ok(!existsSync(join(dir, 'posters', key)));
    assert.equal(isTraktImage('http://trakt.tv/a.png'), false);
  } finally {
    cleanup();
  }
});

test('configuration: defaults, a Client ID without spaces, the stored tokens', () => {
  const defaults = normalizeConfig({});
  assert.deepEqual(defaults.kinds, ['episode', 'movie', 'streaming']);
  assert.deepEqual(
    [
      defaults.daysAhead,
      defaults.intervalHours,
      defaults.notifyHour,
      defaults.specials,
      defaults.watching,
    ],
    [60, 3, 9, false, true],
  );
  const config = normalizeConfig({
    client_id: ' abc def ',
    kinds: '["movie","nope"]',
    days_ahead: '90',
    watching: 'false',
    notify_hour: '',
    access_token: 'a',
    refresh_token: 'r',
    token_expires_at: '123',
  });
  assert.equal(config.clientId, 'abcdef');
  assert.deepEqual(config.kinds, ['movie']);
  assert.equal(config.daysAhead, 90);
  assert.equal(config.watching, false);
  assert.equal(config.notifyHour, 9);
  assert.deepEqual(config.tokens, { accessToken: 'a', refreshToken: 'r', expiresAt: 123 });
});
