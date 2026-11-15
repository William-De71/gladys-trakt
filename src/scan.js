// -----------------------------------------------------------------------------
// A reading of the Trakt account.
//
//   1. The calendars of the kept kinds (`/calendars/my/shows|movies|streaming`),
//      33 days per request (the maximum of Trakt), from 7 days back to
//      `days_ahead` days ahead: 3 to 4 requests per kind.
//   2. The shows in progress and their next episode (`/sync/progress/up_next`).
//   3. Once a day, the settings of the account (user name, VIP).
//
// A kind whose every request succeeded is replaced: what Trakt no longer
// answers is removed. A kind that failed keeps what it had. What changed is
// returned for the scene triggers:
//   - `added`    `{ item, baseline }`: an item never seen. `baseline` is true
//                when it must not be announced: the first reading of its
//                kind, a day that just entered the window as it slides, or
//                the reading that follows a write of a scene action;
//   - `updated`  `{ before, after }`: its day or time changed.
// -----------------------------------------------------------------------------

import { KINDS, calendarChunks, dayOf, posterOf, toEpisodeItems, toMovieItems } from './items.js';
import { DAY_MS, HOUR_MS, MINUTE_MS, addDays } from './time.js';

const BACK_DAYS = 7;
const UP_NEXT_LIMIT = 20;
const RETRY_MS = 15 * MINUTE_MS;
const SEEN_DAYS = 180;
// Errors after which asking the other kinds is pointless.
const FATAL = ['auth', 'forbidden', 'rate', 'locked', 'network'];

const text = (value, max = 300) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);

/**
 * @description A show in progress, from an `up_next` entry.
 * @param {object} entry - `{ show, progress }`.
 * @returns {object|null} Null without a next episode.
 */
function toUpNext(entry) {
  const next = entry?.progress?.next_episode;
  const id = entry?.show?.ids?.trakt;
  if (!Number.isInteger(id) || !Number.isInteger(next?.season) || !Number.isInteger(next?.number)) {
    return null;
  }
  const aired = Date.parse(next.first_aired);
  const watched = Date.parse(entry.progress.last_watched_at);
  return {
    traktId: id,
    slug: text(entry.show.ids.slug, 200),
    title: text(entry.show.title) || `#${id}`,
    year: Number.isInteger(entry.show.year) ? entry.show.year : null,
    poster: posterOf(entry.show.images),
    aired: count(entry.progress.aired),
    completed: count(entry.progress.completed),
    lastWatchedAt: Number.isFinite(watched) ? new Date(watched).toISOString() : null,
    season: next.season,
    number: next.number,
    episodeId: Number.isInteger(next.ids?.trakt) ? next.ids.trakt : null,
    episodeTitle: text(next.title),
    at: Number.isFinite(aired) ? new Date(aired).toISOString() : null,
  };
}

/**
 * @description Create the scanner.
 * @param {object} options - Dependencies.
 * @param {object} options.client - Trakt client (src/trakt.js).
 * @param {object} options.store - State (src/store.js).
 * @param {Function} options.config - `() => normalized config`.
 * @param {Function} options.linked - `() => boolean`: signed in.
 * @param {Function} options.today - `() => 'YYYY-MM-DD'`.
 * @param {Function} options.now - Clock, in ms.
 * @param {string} [options.timeZone] - Timezone of the instance.
 * @param {object} [options.logger] - SDK logger.
 * @returns {object} `{ run, due, running }`.
 */
function createScanner({ client, store, config, linked, today, now, timeZone, logger }) {
  let running = false;

  const readKind = async (kind, chunks, specials) => {
    const raw = [];
    for (const { start, days } of chunks) {
      raw.push(...((await client.calendar(kind, start, days)) ?? []));
    }
    return kind === 'episode' ? toEpisodeItems(raw, { specials }) : toMovieItems(raw, kind);
  };

  const readAccount = async () => {
    const { account } = store.data;
    if (account.username && now() - (account.at ?? 0) < DAY_MS) {
      return;
    }
    const settings = await client.settings();
    const username = text(settings?.user?.username, 100);
    if (username) {
      store.data.account = { username, vip: settings.user.vip === true, at: now() };
    }
  };

  const run = async () => {
    const { kinds, daysAhead, specials } = config();
    const { data } = store;
    const day = today();
    const from = addDays(day, -BACK_DAYS);
    const until = addDays(day, daysAhead);
    const chunks = calendarChunks(day, { back: BACK_DAYS, ahead: daysAhead });
    const previous = data.scan;
    const added = [];
    const updated = [];
    let error = null;

    for (const kind of KINDS.filter((candidate) => !kinds.includes(candidate))) {
      for (const item of store.items().filter((candidate) => candidate.kind === kind)) {
        delete data.items[item.id];
      }
      delete data.kindsRead[kind];
    }

    for (const kind of kinds) {
      if (error && FATAL.includes(error.kind)) {
        break;
      }
      let items;
      try {
        items = await readKind(kind, chunks, specials);
      } catch (err) {
        error = { kind: err.kind ?? 'unknown', message: err.message };
        logger?.warn(`reading of the ${kind} calendar failed: ${err.message}`);
        continue;
      }
      const kept = new Map(
        items
          .filter((item) => dayOf(item, timeZone) >= from && dayOf(item, timeZone) <= until)
          .map((item) => [item.id, item]),
      );
      const firstReading = !data.kindsRead[kind];
      for (const item of store.items().filter((candidate) => candidate.kind === kind)) {
        if (!kept.has(item.id)) {
          delete data.items[item.id];
        }
      }
      for (const item of kept.values()) {
        const before = data.items[item.id];
        if (!before) {
          if (!(item.id in data.seen)) {
            added.push({
              item,
              baseline:
                firstReading ||
                previous.quiet === true ||
                !previous.until ||
                dayOf(item, timeZone) > previous.until,
            });
          }
        } else if (before.at !== item.at || before.date !== item.date) {
          updated.push({ before, after: item });
        }
        data.items[item.id] = item;
        data.seen[item.id] = day;
      }
      data.kindsRead[kind] = true;
    }

    if (!error || !FATAL.includes(error.kind)) {
      try {
        const list = ((await client.upNext(UP_NEXT_LIMIT)) ?? []).map(toUpNext).filter(Boolean);
        data.upNext = { list, at: now() };
      } catch (err) {
        logger?.warn(`reading of the shows in progress failed: ${err.message}`);
      }
      try {
        await readAccount();
      } catch (err) {
        logger?.warn(`reading of the account failed: ${err.message}`);
      }
    }

    const oldest = addDays(day, -SEEN_DAYS);
    for (const [id, last] of Object.entries(data.seen)) {
      if (last < oldest) {
        delete data.seen[id];
      }
    }
    data.scan = {
      at: now(),
      okAt: error ? (previous.okAt ?? 0) : now(),
      error,
      // A failed reading keeps the window and the "quiet" of the previous one.
      until: error ? (previous.until ?? null) : until,
      quiet: error ? previous.quiet === true : false,
    };
    store.changed();
    return { ok: !error, added, updated };
  };

  return {
    /**
     * @returns {Promise<object>} `{ ok, added, updated }`; nothing is read
     * (and `ok` is false) when the account is not linked.
     */
    async run() {
      if (running || !linked()) {
        return { ok: false, added: [], updated: [] };
      }
      running = true;
      try {
        return await run();
      } finally {
        running = false;
      }
    },
    /** @returns {boolean} Whether a reading is due now. */
    due() {
      if (running || !linked() || client.pausedUntil) {
        return false;
      }
      const { at = 0, error } = store.data.scan;
      const interval = config().intervalHours * HOUR_MS;
      return now() - at >= (error ? Math.min(interval, RETRY_MS) : interval);
    },
    get running() {
      return running;
    },
  };
}

export { BACK_DAYS, UP_NEXT_LIMIT, toUpNext, createScanner };
