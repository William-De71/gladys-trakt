// -----------------------------------------------------------------------------
// What the account is watching now (`/users/me/watching`).
//
// Trakt knows it from the players that "scrobble" to it (Plex, Kodi, Jellyfin,
// Infuse, the Trakt apps…) and from manual check-ins: it answers the movie or
// the episode with `started_at` and `expires_at` (start + runtime), or 204
// when nothing plays. A paused player stops the scrobble: Trakt then answers
// 204, and the item again when the playback resumes.
//
// The integration asks once a minute and turns the changes into two
// transitions: "started" and "stopped" (`finished` when the end of the runtime
// was reached, two minutes short). The first answer after a start of the
// integration is a baseline: it fires nothing. A failed request changes
// nothing.
// -----------------------------------------------------------------------------

import { posterOf } from './items.js';

const FINISHED_MARGIN_MS = 2 * 60 * 1000;

const text = (value, max = 300) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const instant = (value) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};

/**
 * @description What is being watched, from the answer of Trakt.
 * @param {object|null} raw - The answer (null for a 204).
 * @returns {object|null} `{ key, kind, title, … }`, null when nothing plays.
 */
function toWatching(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const startedAt = instant(raw.started_at);
  if (raw.type === 'movie' && Number.isInteger(raw.movie?.ids?.trakt)) {
    const { movie } = raw;
    return {
      key: `movie-${movie.ids.trakt}`,
      kind: 'movie',
      traktId: movie.ids.trakt,
      slug: text(movie.ids.slug, 200),
      title: text(movie.title) || `#${movie.ids.trakt}`,
      year: Number.isInteger(movie.year) ? movie.year : null,
      poster: posterOf(movie.images),
      startedAt,
      expiresAt: instant(raw.expires_at),
    };
  }
  if (
    raw.type === 'episode' &&
    Number.isInteger(raw.episode?.ids?.trakt) &&
    Number.isInteger(raw.show?.ids?.trakt)
  ) {
    const { episode, show } = raw;
    return {
      key: `episode-${episode.ids.trakt}`,
      kind: 'episode',
      traktId: show.ids.trakt,
      slug: text(show.ids.slug, 200),
      title: text(show.title) || `#${show.ids.trakt}`,
      year: Number.isInteger(show.year) ? show.year : null,
      season: Number.isInteger(episode.season) ? episode.season : 0,
      number: Number.isInteger(episode.number) ? episode.number : 0,
      episodeTitle: text(episode.title),
      poster: posterOf(show.images),
      startedAt,
      expiresAt: instant(raw.expires_at),
    };
  }
  return null;
}

/**
 * @description Create the watcher.
 * @param {object} options - `{ client, store, now }`.
 * @returns {{ poll: Function, reset: Function }} The watcher.
 */
function createWatcher({ client, store, now }) {
  let primed = false;

  return {
    /**
     * @description Ask Trakt and compare with the previous answer.
     * @returns {Promise<{ started: object|null, stopped: object|null, changed: boolean }>}
     * `stopped` is `{ item, finished, minutes }`.
     */
    async poll() {
      const next = toWatching(await client.watching());
      const state = store.data.watching;
      const previous = state.current ?? null;
      const changed = (previous?.key ?? null) !== (next?.key ?? null);
      const result = { started: null, stopped: null, changed };
      if (changed && primed) {
        if (previous) {
          const end = Date.parse(previous.expiresAt);
          const start = Date.parse(previous.startedAt);
          result.stopped = {
            item: previous,
            finished: Number.isFinite(end) && now() >= end - FINISHED_MARGIN_MS,
            minutes: Number.isFinite(start)
              ? Math.max(0, Math.round((Math.min(now(), end || now()) - start) / 60000))
              : 0,
          };
        }
        result.started = next;
      }
      primed = true;
      if (changed || previous?.expiresAt !== next?.expiresAt) {
        if (previous && !next) {
          state.last = { ...previous, stoppedAt: new Date(now()).toISOString() };
        }
        state.current = next;
        store.changed();
      }
      return result;
    },
    /** Make the next answer a baseline again (sign-in, option turned on). */
    reset() {
      primed = false;
    },
  };
}

export { FINISHED_MARGIN_MS, toWatching, createWatcher };
