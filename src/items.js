// -----------------------------------------------------------------------------
// What the Trakt calendar holds: the "items" of the integration.
//
// Three kinds, each read from one calendar of the account (`/calendars/my/…`):
//   - `episode`    an episode of a show the account watches or keeps in its
//                  watchlist. It has an instant (`at`, the first airing, UTC).
//                  Episodes of one show airing at the same instant (a season
//                  dropped at once) are one item: "S02E01–E08";
//   - `movie`      the release of a movie of the watchlist (a calendar date);
//   - `streaming`  its streaming release (a calendar date).
//
// Ids are built from the Trakt ids, which never change:
//   ep-<show id>-<season>-<first episode number>    mv-<movie id>    st-<movie id>
// An item is a plain object, kept as is in /data/state.json.
// -----------------------------------------------------------------------------

import { addDays, localClock } from './time.js';

const KINDS = ['episode', 'movie', 'streaming'];
const DEFAULT_KINDS = [...KINDS];
const SITE = 'https://trakt.tv';
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_RUNTIME = 30;
const PREMIERES = ['series_premiere', 'season_premiere', 'mid_season_premiere'];
const FINALES = ['series_finale', 'season_finale', 'mid_season_finale'];

const text = (value, max = 300) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const positive = (value) => (Number.isInteger(value) && value >= 0 ? value : null);

/**
 * @description The address of a Trakt image, as the API gives it (no scheme).
 * @param {object} images - The `images` object of a show or a movie.
 * @returns {string} `https://…`, '' when there is no poster.
 */
function posterOf(images) {
  const first = Array.isArray(images?.poster) ? images.poster[0] : '';
  if (typeof first !== 'string' || !first) {
    return '';
  }
  return /^https?:\/\//.test(first) ? first.replace(/^http:/, 'https:') : `https://${first}`;
}

/**
 * @description The episodes of a calendar answer, grouped per show and instant.
 * @param {object[]} raw - The answer of `/calendars/my/shows`.
 * @param {object} [options] - `{ specials }`: keep season 0.
 * @returns {object[]} The items.
 */
function toEpisodeItems(raw, { specials = false } = {}) {
  const groups = new Map();
  for (const entry of Array.isArray(raw) ? raw : []) {
    const showId = positive(entry?.show?.ids?.trakt);
    const season = positive(entry?.episode?.season);
    const number = positive(entry?.episode?.number);
    const instant = Date.parse(entry?.first_aired);
    if (showId === null || season === null || number === null || !Number.isFinite(instant)) {
      continue;
    }
    if (season === 0 && !specials) {
      continue;
    }
    const key = `${showId}|${instant}`;
    if (!groups.has(key)) {
      groups.set(key, { show: entry.show, instant, episodes: [] });
    }
    groups.get(key).episodes.push(entry.episode);
  }
  const items = [];
  for (const { show, instant, episodes } of groups.values()) {
    episodes.sort((a, b) => a.season - b.season || a.number - b.number);
    const [first] = episodes;
    const last = episodes.at(-1);
    const special = episodes
      .map((episode) => text(episode.episode_type, 40))
      .find((type) => PREMIERES.includes(type) || FINALES.includes(type));
    items.push({
      id: `ep-${show.ids.trakt}-${first.season}-${first.number}`,
      kind: 'episode',
      at: new Date(instant).toISOString(),
      date: null,
      title: text(show.title) || `#${show.ids.trakt}`,
      year: positive(show.year),
      traktId: show.ids.trakt,
      slug: text(show.ids.slug, 200),
      season: first.season,
      number: first.number,
      lastSeason: last.season,
      lastNumber: last.number,
      count: episodes.length,
      episodeId: positive(first.ids?.trakt),
      episodeTitle: episodes.length === 1 ? text(first.title) : '',
      episodeType: special ?? (episodes.length > 1 ? 'multiple_episodes' : 'standard'),
      runtime: positive(first.runtime) || positive(show.runtime) || DEFAULT_RUNTIME,
      network: text(show.network, 80),
      poster: posterOf(show.images),
    });
  }
  return items;
}

/**
 * @description The movies of a calendar answer.
 * @param {object[]} raw - The answer of `/calendars/my/movies` or `/streaming`.
 * @param {string} kind - `movie` or `streaming`.
 * @returns {object[]} The items.
 */
function toMovieItems(raw, kind) {
  const items = new Map();
  for (const entry of Array.isArray(raw) ? raw : []) {
    const id = positive(entry?.movie?.ids?.trakt);
    const date = text(entry?.released, 10);
    if (id === null || !DATE_REGEX.test(date)) {
      continue;
    }
    const { movie } = entry;
    items.set(id, {
      id: `${kind === 'streaming' ? 'st' : 'mv'}-${id}`,
      kind,
      at: null,
      date,
      title: text(movie.title) || `#${id}`,
      year: positive(movie.year),
      traktId: id,
      slug: text(movie.ids.slug, 200),
      runtime: positive(movie.runtime) || 0,
      network: '',
      poster: posterOf(movie.images),
    });
  }
  return [...items.values()];
}

/**
 * @description The local day of an item.
 * @param {object} item - An item.
 * @param {string} [timeZone] - Timezone of the instance.
 * @returns {string} `YYYY-MM-DD`.
 */
function dayOf(item, timeZone) {
  return item.at ? localClock(Date.parse(item.at), timeZone).date : item.date;
}

/**
 * @description The local time of an episode.
 * @param {object} item - An item.
 * @param {string} [timeZone] - Timezone of the instance.
 * @returns {string} "21:00", '' for a movie.
 */
function timeOf(item, timeZone) {
  if (!item.at) {
    return '';
  }
  const { minutes } = localClock(Date.parse(item.at), timeZone);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

const two = (value) => String(value).padStart(2, '0');

/**
 * @description "S02E05", "S02E01–E08", "S01E10–S02E01"; '' for a movie.
 * @param {object} item - An item (or the next episode of a show).
 * @returns {string} The code.
 */
function episodeCode(item) {
  if (!Number.isInteger(item.season) || !Number.isInteger(item.number)) {
    return '';
  }
  const first = `S${two(item.season)}E${two(item.number)}`;
  if (!item.count || item.count < 2) {
    return first;
  }
  return item.lastSeason === item.season
    ? `${first}–E${two(item.lastNumber)}`
    : `${first}–S${two(item.lastSeason)}E${two(item.lastNumber)}`;
}

/**
 * @description The short title: "Severance S02E05", "Dune: Part Three".
 * @param {object} item - An item.
 * @returns {string} The title.
 */
function shortTitle(item) {
  const code = episodeCode(item);
  return code ? `${item.title} ${code}` : item.title;
}

/**
 * @description The full title: "Severance S02E05 – Trojan's Horse".
 * @param {object} item - An item.
 * @returns {string} The title.
 */
function fullTitle(item) {
  return item.episodeTitle ? `${shortTitle(item)} – ${item.episodeTitle}` : shortTitle(item);
}

/**
 * @description The page of an item on trakt.tv.
 * @param {object} item - An item.
 * @returns {string} The URL.
 */
function itemUrl(item) {
  const slug = encodeURIComponent(item.slug || String(item.traktId));
  if (Number.isInteger(item.season) && Number.isInteger(item.number)) {
    return `${SITE}/shows/${slug}/seasons/${item.season}/episodes/${item.number}`;
  }
  return `${SITE}/${item.kind === 'show' ? 'shows' : 'movies'}/${slug}`;
}

const isPremiere = (item) => PREMIERES.includes(item.episodeType);
const isFinale = (item) => FINALES.includes(item.episodeType);

/**
 * @description Order two items by day, then time, then title.
 * @param {string} [timeZone] - Timezone of the instance.
 * @returns {Function} A comparator.
 */
const byDate = (timeZone) => (a, b) =>
  dayOf(a, timeZone).localeCompare(dayOf(b, timeZone)) ||
  (a.at ?? '').localeCompare(b.at ?? '') ||
  a.title.localeCompare(b.title) ||
  a.id.localeCompare(b.id);

const sameTitle = (a, b) =>
  a.localeCompare(b, undefined, { sensitivity: 'base', usage: 'search' }) === 0;

/**
 * @description The items to come, the nearest first.
 * @param {object[]} items - Every item kept.
 * @param {object} filters - `{ today, timeZone, kinds, title }`.
 * @returns {object[]} From today on.
 */
function upcomingItems(items, { today, timeZone, kinds, title }) {
  return items
    .filter(
      (item) =>
        dayOf(item, timeZone) >= today &&
        (!kinds || kinds.includes(item.kind)) &&
        (!title || sameTitle(item.title, title)),
    )
    .sort(byDate(timeZone));
}

/**
 * @description The UTC days a reading asks Trakt for.
 * @param {string} today - Local day.
 * @param {object} window - `{ back, ahead }`, in days.
 * @param {number} [chunk] - Days per request (33 at most on Trakt).
 * @returns {{ start: string, days: number }[]} One entry per request.
 */
function calendarChunks(today, { back, ahead }, chunk = 33) {
  // One day more on each side: the calendars are cut in UTC days.
  const from = addDays(today, -back - 1);
  const total = back + ahead + 3;
  const chunks = [];
  for (let offset = 0; offset < total; offset += chunk) {
    chunks.push({ start: addDays(from, offset), days: Math.min(chunk, total - offset) });
  }
  return chunks;
}

export {
  KINDS,
  DEFAULT_KINDS,
  SITE,
  DEFAULT_RUNTIME,
  posterOf,
  toEpisodeItems,
  toMovieItems,
  dayOf,
  timeOf,
  episodeCode,
  shortTitle,
  fullTitle,
  itemUrl,
  isPremiere,
  isFinale,
  byDate,
  sameTitle,
  upcomingItems,
  calendarChunks,
};
