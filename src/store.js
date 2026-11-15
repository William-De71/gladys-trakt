// -----------------------------------------------------------------------------
// What the integration keeps across restarts, in /data/state.json (the only
// writable place of the container):
//   - `items`      the calendar items read, by id (src/items.js);
//   - `seen`       every item id ever read -> the last day it was: an item
//                  that leaves the answers and comes back is not "announced"
//                  twice;
//   - `kindsRead`  the kinds read at least once: the first reading of a kind
//                  is a baseline, it announces nothing;
//   - `upNext`     `{ list, at }`: the shows in progress and their next episode;
//   - `account`    `{ username, vip, at }`: the Trakt account, read daily;
//   - `watching`   `{ current, last }`: what is being watched, what was last;
//   - `posters`    widget image key -> `{ url, ok, at, used }` (src/images.js);
//   - `fired`      the "release day" and "airs now" events already sent ->
//                  when to forget;
//   - `scan`       the last reading: `{ at, okAt, error, until, quiet }`.
// The tokens are not here: they live in the configuration of Gladys, which is
// backed up. Writes are atomic (a temporary file, then a rename) and grouped.
// -----------------------------------------------------------------------------

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULT_PATH = '/data/state.json';
const FLUSH_DELAY_MS = 5000;

const EMPTY = () => ({
  items: {},
  seen: {},
  kindsRead: {},
  upNext: {},
  account: {},
  watching: {},
  posters: {},
  fired: {},
  scan: {},
});

/**
 * @description The store.
 * @param {object} [options] - `{ path, logger, flushDelay }`.
 * @returns {object} The store: `data` (the state, changed in place), `changed()` and `flush()`.
 */
function createStore({ path = DEFAULT_PATH, logger, flushDelay = FLUSH_DELAY_MS } = {}) {
  const data = EMPTY();
  let timer = null;

  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    for (const part of Object.keys(data)) {
      if (raw?.[part] && typeof raw[part] === 'object' && !Array.isArray(raw[part])) {
        data[part] = raw[part];
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger?.warn(`unable to read ${path}: ${error.message}`);
    }
  }

  const flush = () => {
    clearTimeout(timer);
    timer = null;
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(`${path}.tmp`, JSON.stringify(data));
      renameSync(`${path}.tmp`, path);
    } catch (error) {
      logger?.warn(`unable to write ${path}: ${error.message}`);
    }
  };

  return {
    data,
    path,
    /** @returns {object[]} Every item kept. */
    items: () => Object.values(data.items),
    /** @returns {object[]} The shows in progress. */
    upNext: () => (Array.isArray(data.upNext.list) ? data.upNext.list : []),
    /** Schedule a write. */
    changed() {
      if (!timer) {
        timer = setTimeout(flush, flushDelay);
        timer.unref?.();
      }
    },
    /**
     * @param {string} key - `<event>|<item id>|…`.
     * @returns {boolean} Whether this event was sent.
     */
    wasFired: (key) => key in data.fired,
    /**
     * @param {string} key - `<event>|<item id>|…`.
     * @param {number} until - When the entry can be forgotten, in ms.
     */
    markFired(key, until) {
      data.fired[key] = until;
      this.changed();
    },
    /** @param {number} now - Forget the events of items long out. */
    pruneFired(now) {
      for (const [key, until] of Object.entries(data.fired)) {
        if (until < now) {
          delete data.fired[key];
          this.changed();
        }
      }
    },
    /** Forget everything read from the account (disconnect); the posters stay cached. */
    clearAccount() {
      for (const part of [
        'items',
        'seen',
        'kindsRead',
        'upNext',
        'account',
        'watching',
        'fired',
        'scan',
      ]) {
        data[part] = {};
      }
      this.changed();
    },
    flush,
  };
}

export { DEFAULT_PATH, createStore };
