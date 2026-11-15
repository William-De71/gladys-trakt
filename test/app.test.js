// The whole integration against the fake Gladys of the SDK
// (`@gladysassistant/integration-sdk/testing`, which checks the calendars,
// the scene events and the widgets like the host API), a fake Trakt behind
// `fetch` and a clock moved by hand, in Europe/Paris.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import {
  ACTIONS,
  NEXT_OUTPUTS,
  SCENE_ACTIONS,
  TRIGGERS,
  WRITE_OUTPUTS,
  createApp,
} from '../src/app.js';
import { INTERNAL_KEYS } from '../src/config.js';
import { WIDGETS } from '../src/widgets.js';
import {
  CLIENT_ID,
  SHOWS,
  TZ,
  episodeEntry,
  fakeClock,
  fakeTrakt,
  movieEntry,
  silentLogger,
  tempStore,
  upNextEntry,
} from './helpers.js';

const MANIFEST = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

// A user who enabled the integration in "My calendars".
const JOHN = { user: { selector: 'john', first_name: 'John', language: 'fr' }, config: {} };
const NOW = '2026-11-14T08:00:00Z'; // Saturday 09:00 in Paris
const WEEK_MS = 7 * 24 * 3600 * 1000;

const LINKED = {
  client_id: CLIENT_ID,
  language: 'fr',
  [INTERNAL_KEYS.accessToken]: 'access-1',
  [INTERNAL_KEYS.refreshToken]: 'refresh-1',
  [INTERNAL_KEYS.expiresAt]: String(Date.parse(NOW) + WEEK_MS),
};

const calendar = () => ({
  shows: [
    // Tuesday 18 Nov, 02:00 UTC = 03:00 in Paris.
    episodeEntry(SHOWS.SEVERANCE, 2, 5, '2026-11-18T02:00:00.000Z', { title: 'Trojan’s Horse' }),
    // A whole season at once.
    ...[1, 2, 3].map((n) =>
      episodeEntry(SHOWS.ANDOR, 2, n, '2026-11-21T08:00:00.000Z', {
        episode_type: n === 1 ? 'season_premiere' : 'standard',
      }),
    ),
    // A special: left out by default.
    episodeEntry(SHOWS.SEVERANCE, 0, 1, '2026-11-16T02:00:00.000Z'),
  ],
  movies: [movieEntry(501, 'Dune: Part Three', '2026-12-18')],
  streaming: [movieEntry(502, 'Wicked: For Good', '2026-11-16')],
  upNext: [upNextEntry(SHOWS.SEVERANCE, { aired: 14, completed: 13, season: 2, number: 4 })],
});

/**
 * @description An integration wired to the fake Gladys, its first tick done.
 * @param {object} [options] - `{ config, trakt, start }`.
 * @returns {Promise<object>} `{ gladys, app, trakt, clock, store, cleanup }`.
 */
async function setup({ config = LINKED, trakt = fakeTrakt(calendar()), start = NOW } = {}) {
  const gladys = createFakeGladys({ config, calendarAccounts: [JOHN] });
  const clock = fakeClock(start);
  const { store, cleanup } = tempStore();
  const app = createApp(gladys, {
    fetchImpl: trakt.fetch,
    store,
    now: clock.now,
    timeZone: TZ,
    sleep: async () => {},
    logger: silentLogger,
  });
  await gladys.connect();
  await app.tick();
  await app.idle();
  return { gladys: gladys.fake, app, trakt, clock, store, cleanup };
}

const eventsOf = (gladys, key) => gladys.sceneEvents.filter((event) => event.key === key);
const lastEvents = (gladys) => gladys.publishedCalendarEvents.at(-1).events;

test('the manifest and the code agree on every key', () => {
  assert.deepEqual(MANIFEST.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  assert.deepEqual(
    MANIFEST.scene_actions.map((a) => a.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  assert.deepEqual(
    MANIFEST.scene_triggers.map((t) => t.key).sort(),
    Object.values(TRIGGERS).sort(),
  );
  assert.deepEqual(MANIFEST.widgets.map((w) => w.key).sort(), Object.values(WIDGETS).sort());
  const outputs = Object.fromEntries(
    MANIFEST.scene_actions.map((a) => [a.key, a.outputs.map((o) => o.key).sort()]),
  );
  assert.deepEqual(outputs[SCENE_ACTIONS.NEXT], [...NEXT_OUTPUTS].sort());
  assert.deepEqual(outputs[SCENE_ACTIONS.WATCHLIST], [...WRITE_OUTPUTS].sort());
  assert.deepEqual(outputs[SCENE_ACTIONS.WATCHED], [...WRITE_OUTPUTS].sort());
});

test('without Client ID nor account: nothing is asked, the status says what to do', async () => {
  const { gladys, trakt, cleanup } = await setup({ config: {} });
  try {
    assert.deepEqual(trakt.calls, []);
    assert.equal(gladys.connectionStatus.connected, false);
    assert.match(gladys.connectionStatus.message.en, /Client ID/);
    const ack = await gladys.oauthAuthorizeUrl('trakt_account');
    assert.equal(ack.success, false);
  } finally {
    cleanup();
  }
});

test('sign-in: the code in the status, the tokens stored, then a first reading', async () => {
  const trakt = fakeTrakt({ ...calendar(), pending: 2 });
  const { gladys, app, cleanup } = await setup({ config: { client_id: CLIENT_ID }, trakt });
  try {
    assert.match(gladys.connectionStatus.message.en, /Not linked/);
    const ack = await gladys.oauthAuthorizeUrl('trakt_account');
    assert.equal(ack.success, true, ack.error);
    assert.equal(ack.data.authorize_url, 'https://trakt.tv/activate');
    assert.ok(
      gladys.connectionStatuses.some((s) => /ABCD1234 on trakt\.tv\/activate/.test(s.message.en)),
    );
    await app.idle();
    assert.equal(gladys.config[INTERNAL_KEYS.accessToken], 'access-1');
    assert.equal(gladys.config[INTERNAL_KEYS.refreshToken], 'refresh-1');
    assert.equal(gladys.connectionStatus.connected, true);
    assert.match(gladys.connectionStatus.message.en, /^Linked to jane · items to come: 4\.$/);
    assert.ok(lastEvents(gladys).length > 0);
    // A first reading announces nothing.
    assert.equal(eventsOf(gladys, TRIGGERS.ANNOUNCED).length, 0);
  } finally {
    cleanup();
  }
});

test('sign-in denied or unknown Client ID: said clearly', async () => {
  const denied = await setup({
    config: { client_id: CLIENT_ID },
    trakt: fakeTrakt({ deviceAnswer: 418 }),
  });
  try {
    await denied.gladys.oauthAuthorizeUrl('trakt_account');
    await denied.app.idle();
    assert.match(denied.gladys.connectionStatus.message.en, /denied/);
  } finally {
    denied.cleanup();
  }
  const wrong = await setup({ config: { client_id: 'nope' }, trakt: fakeTrakt() });
  try {
    const ack = await wrong.gladys.oauthAuthorizeUrl('trakt_account');
    assert.equal(ack.success, false);
    assert.match(ack.error, /ne connaît pas ce Client ID|does not know this Client ID/);
  } finally {
    wrong.cleanup();
  }
});

test('calendar: timed episodes, a season dropped at once, all-day releases', async () => {
  const { gladys, trakt, cleanup } = await setup();
  try {
    const [published] = gladys.publishedCalendars.at(-1).calendars;
    assert.equal(published.name, 'Séries et films');
    assert.match(published.external_id, /:john:watch$/);
    const events = lastEvents(gladys).map((e) => [e.name, e.start, e.end, e.full_day === true]);
    assert.deepEqual(events, [
      ['Wicked: For Good', '2026-11-16', '2026-11-17', true],
      [
        'Severance S02E05 – Trojan’s Horse',
        '2026-11-18T02:00:00.000Z',
        '2026-11-18T02:50:00.000Z',
        false,
      ],
      ['Andor S02E01–E03', '2026-11-21T08:00:00.000Z', '2026-11-21T10:15:00.000Z', false],
      ['Dune: Part Three', '2026-12-18', '2026-12-19', true],
    ]);
    const severance = lastEvents(gladys)[1];
    assert.match(severance.external_id, /:john:ep-154997-2-5$/);
    assert.equal(severance.url, 'https://trakt.tv/shows/severance/seasons/2/episodes/5');
    // 7 days back + 60 ahead + margins: 3 requests of 33 days per kind.
    const shows = trakt.calls.filter((call) => call.includes('/calendars/my/shows/'));
    assert.deepEqual(shows, [
      'GET /calendars/my/shows/2026-11-06/33',
      'GET /calendars/my/shows/2026-12-09/33',
      'GET /calendars/my/shows/2027-01-11/4',
    ]);
  } finally {
    cleanup();
  }
});

test('a new item is announced once; a slide of the window or a write is not', async () => {
  const { gladys, app, trakt, clock, cleanup } = await setup();
  try {
    trakt.state.shows.push(
      episodeEntry(SHOWS.SEVERANCE, 2, 6, '2026-11-25T02:00:00.000Z', {
        episode_type: 'season_finale',
      }),
    );
    // Beyond the 60 days read: it only enters the window as it slides.
    trakt.state.movies.push(movieEntry(503, 'Far Away', '2027-02-01'));
    clock.advance(3 * 3600 * 1000);
    await app.tick();
    await app.idle();
    const announced = eventsOf(gladys, TRIGGERS.ANNOUNCED);
    assert.equal(announced.length, 1);
    assert.equal(announced[0].data.full_title, 'Severance S02E06 – Episode 6');
    assert.equal(announced[0].data.finale, true);
    assert.equal(announced[0].data.time, '03:00');
    assert.match(announced[0].data.text, /^Nouveau dans votre calendrier Trakt : Severance S02E06/);
    clock.advance(3 * 3600 * 1000);
    await app.tick();
    await app.idle();
    assert.equal(eventsOf(gladys, TRIGGERS.ANNOUNCED).length, 1, 'once');
  } finally {
    cleanup();
  }
});

test('date changed, release day from the configured hour, episode airing now', async () => {
  const { gladys, app, trakt, clock, cleanup } = await setup();
  try {
    trakt.state.shows[0].first_aired = '2026-11-19T02:00:00.000Z';
    clock.advance(3 * 3600 * 1000);
    await app.tick();
    await app.idle();
    const [changed] = eventsOf(gladys, TRIGGERS.DATE_CHANGED);
    assert.equal(changed.data.previous_date, '2026-11-18');
    assert.equal(changed.data.date, '2026-11-19');
    // Sunday 15 Nov 09:00: Wicked comes out on streaming tomorrow.
    clock.set('2026-11-15T08:00:00Z');
    await app.tick();
    await app.idle();
    const day = eventsOf(gladys, TRIGGERS.DAY);
    // Andor (21 Nov) was a week away since the 14th, Wicked comes out tomorrow.
    assert.deepEqual(
      day.map((e) => [e.data.title, e.data.lead]),
      [
        ['Andor', '7'],
        ['Wicked: For Good', '1'],
      ],
    );
    assert.equal(day[1].data.text, 'Wicked: For Good arrive en streaming demain.');
    await app.tick();
    assert.equal(eventsOf(gladys, TRIGGERS.DAY).length, 2, 'once per item, day and lead');
    // Saturday 21 Nov 09:03: Andor aired three minutes ago.
    clock.set('2026-11-21T08:03:00Z');
    await app.tick();
    await app.idle();
    const airing = eventsOf(gladys, TRIGGERS.AIRING);
    assert.equal(airing.length, 1);
    assert.equal(airing[0].data.episode, 'S02E01–E03');
    assert.equal(airing[0].data.premiere, true);
  } finally {
    cleanup();
  }
});

test('now watching: a baseline, then started and stopped (finished) events', async () => {
  const { gladys, app, trakt, clock, cleanup } = await setup();
  try {
    assert.equal(eventsOf(gladys, TRIGGERS.WATCHING_STARTED).length, 0);
    trakt.state.watching = {
      started_at: '2026-11-14T08:01:00.000Z',
      expires_at: '2026-11-14T08:51:00.000Z',
      action: 'scrobble',
      type: 'episode',
      episode: { season: 2, number: 4, title: 'Woe’s Hollow', ids: { trakt: 154997204 } },
      show: SHOWS.SEVERANCE,
    };
    clock.advance(60 * 1000);
    await app.tick();
    await app.idle();
    const [started] = eventsOf(gladys, TRIGGERS.WATCHING_STARTED);
    assert.equal(started.data.full_title, 'Severance S02E04 – Woe’s Hollow');
    assert.equal(started.data.ends_at, '09:51');
    const widget = await gladys.widgetGet(WIDGETS.WATCHING, { language: 'fr' });
    assert.equal(widget.success, true, widget.error);
    trakt.state.watching = null;
    clock.set('2026-11-14T08:50:00Z');
    await app.tick();
    await app.idle();
    const [stopped] = eventsOf(gladys, TRIGGERS.WATCHING_STOPPED);
    assert.equal(stopped.data.finished, 'true');
    assert.equal(stopped.data.minutes, 49);
  } finally {
    cleanup();
  }
});

test('tokens: renewed a day before the expiry; a dead one asks to connect again', async () => {
  const { gladys, app, trakt, clock, cleanup } = await setup();
  try {
    clock.advance(6.5 * 24 * 3600 * 1000);
    await app.tick();
    await app.idle();
    assert.equal(gladys.config[INTERNAL_KEYS.refreshToken], 'refresh-2');
    assert.equal(gladys.config[INTERNAL_KEYS.accessToken], 'access-2');
    // Revoked on trakt.tv: the access token and the refresh token die.
    trakt.state.accessToken = 'revoked';
    trakt.state.refreshToken = 'revoked';
    clock.advance(3 * 3600 * 1000);
    await app.tick();
    await app.idle();
    assert.equal(eventsOf(gladys, TRIGGERS.DISCONNECTED).length, 1);
    assert.equal(gladys.connectionStatus.connected, false);
    assert.match(gladys.connectionStatus.message.en, /click Connect again/);
  } finally {
    cleanup();
  }
});

test('scene action get_next: the next item, filtered by kind and title', async () => {
  const { gladys, cleanup } = await setup();
  try {
    const next = await gladys.sceneAction(SCENE_ACTIONS.NEXT, {});
    assert.equal(next.success, true, next.error);
    const outputs = next.data.outputs ?? next.data;
    assert.deepEqual(Object.keys(outputs).sort(), [...NEXT_OUTPUTS].sort());
    assert.equal(outputs.title, 'Wicked: For Good');
    const andor = await gladys.sceneAction(SCENE_ACTIONS.NEXT, { title: 'andor' });
    const values = andor.data.outputs ?? andor.data;
    assert.equal(values.episode, 'S02E01–E03');
    assert.equal(values.time, '09:00');
    assert.equal(values.days, 7);
    const none = await gladys.sceneAction(SCENE_ACTIONS.NEXT, { title: 'Nothing' });
    assert.equal((none.data.outputs ?? none.data).found, false);
  } finally {
    cleanup();
  }
});

test('scene actions that write: watchlist, mark watched, no event, no double play', async () => {
  const trakt = fakeTrakt({
    ...calendar(),
    search: {
      Dune: [
        {
          type: 'movie',
          movie: { title: 'Dune', year: 1984, ids: { trakt: 7, slug: 'dune-1984' } },
        },
        {
          type: 'movie',
          movie: { title: 'Dune', year: 2021, ids: { trakt: 8, slug: 'dune-2021' } },
        },
      ],
    },
  });
  const { gladys, app, cleanup } = await setup({ trakt });
  try {
    const add = await gladys.sceneAction(SCENE_ACTIONS.WATCHLIST, {
      type: 'movie',
      title: 'Dune (2021)',
    });
    assert.equal(add.success, true, add.error);
    const added = add.data.outputs ?? add.data;
    assert.deepEqual(Object.keys(added).sort(), [...WRITE_OUTPUTS].sort());
    assert.deepEqual([added.done, added.status, added.year], [true, 'added', 2021]);
    assert.equal(added.url, 'https://trakt.tv/movies/dune-2021');
    const again = await gladys.sceneAction(SCENE_ACTIONS.WATCHLIST, {
      type: 'movie',
      title: 'Dune (2021)',
    });
    assert.equal((again.data.outputs ?? again.data).status, 'existing');
    const missing = await gladys.sceneAction(SCENE_ACTIONS.WATCHLIST, {
      type: 'show',
      title: 'Zzz',
    });
    assert.equal((missing.data.outputs ?? missing.data).status, 'not_found');

    const marked = await gladys.sceneAction(SCENE_ACTIONS.WATCHED, {
      type: 'next_episode',
      title: 'Severance',
    });
    const done = marked.data.outputs ?? marked.data;
    assert.deepEqual([done.done, done.status], [true, 'marked']);
    assert.deepEqual(trakt.state.history, [{ episodes: [{ ids: { trakt: 154997204 } }] }]);
    const twice = await gladys.sceneAction(SCENE_ACTIONS.WATCHED, {
      type: 'next_episode',
      title: 'Severance',
    });
    assert.equal((twice.data.outputs ?? twice.data).status, 'already');
    assert.equal(trakt.state.history.length, 1);
    // The reading that follows a write announces nothing.
    trakt.state.movies.push(movieEntry(8, 'Dune', '2026-12-01'));
    await app.idle();
    assert.equal(eventsOf(gladys, TRIGGERS.ANNOUNCED).length, 0);
  } finally {
    cleanup();
  }
});

test('widgets: valid contents in the four languages, posters once cached', async () => {
  const { gladys, cleanup } = await setup();
  try {
    for (const key of Object.values(WIDGETS)) {
      for (const language of ['en', 'fr', 'de', 'es']) {
        const ack = await gladys.widgetGet(key, { language });
        assert.equal(ack.success, true, `${key}: ${ack.error}`);
        const content = ack.data.content ?? ack.data;
        assert.deepEqual(validateWidgetContent(content).warnings ?? [], [], key);
      }
    }
    const upcoming = await gladys.widgetGet(WIDGETS.UPCOMING, { language: 'fr' });
    const list = (upcoming.data.content ?? upcoming.data).components.find(
      (c) => c.type === 'card-list',
    );
    assert.equal(list.items.length, 4);
    assert.match(list.items[1].image, /^tk-[0-9a-f]{16}$/);
    const image = await gladys.widgetGetImage(list.items[1].image);
    assert.equal(image.success, true, image.error);
  } finally {
    cleanup();
  }
});

test('disconnect: the tokens and what was read are forgotten, the calendar emptied', async () => {
  const { gladys, cleanup } = await setup();
  try {
    const ack = await gladys.action(ACTIONS.DISCONNECT);
    assert.equal(ack.success, true, ack.error);
    assert.equal(gladys.config[INTERNAL_KEYS.refreshToken], '');
    assert.deepEqual(lastEvents(gladys), []);
    assert.equal(gladys.connectionStatus.connected, false);
  } finally {
    cleanup();
  }
});
