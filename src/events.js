// -----------------------------------------------------------------------------
// Scene triggers and scene action outputs.
//
// Triggers (one event per transition, never a periodic snapshot):
//   - `item_announced`        an episode or a movie appeared in the Trakt
//                             calendar inside the days already read (a show
//                             just renewed, a title added to the watchlist):
//                             never at the first reading of a kind, never for
//                             a day that only entered the window as it slides,
//                             10 at most per reading;
//   - `release_day`           an item comes out today, tomorrow or in a week
//                             (`lead` 0, 1 or 7), once per item, day and lead,
//                             from `notify_hour` on;
//   - `episode_airing`        an episode airs now (its airing instant passed
//                             within the last 10 minutes), once per episode;
//   - `date_changed`          the day or the time of an item to come changed;
//   - `watching_started` / `watching_stopped`   what the account watches
//                             (src/watching.js);
//   - `account_disconnected`  Trakt refuses the sign-in: Connect again.
// Filters (equality / membership): `kind`, `title` (the show or the movie, as
// Trakt writes it), `lead` for `release_day`. The data is flat and scalar;
// `text` is a ready sentence in the language of the configuration.
//
// No event ever follows a scene action: the reading that follows a write is a
// baseline (src/scan.js).
// -----------------------------------------------------------------------------

import { kindName, t, truncate } from './i18n.js';
import {
  dayOf,
  episodeCode,
  fullTitle,
  isFinale,
  isPremiere,
  itemUrl,
  shortTitle,
  timeOf,
} from './items.js';
import { DAY_MS, MINUTE_MS, addDays, daysBetween, formatTime, fullDate } from './time.js';

const TRIGGERS = {
  ANNOUNCED: 'item_announced',
  DAY: 'release_day',
  AIRING: 'episode_airing',
  DATE_CHANGED: 'date_changed',
  WATCHING_STARTED: 'watching_started',
  WATCHING_STOPPED: 'watching_stopped',
  DISCONNECTED: 'account_disconnected',
};

const LEADS = ['0', '1', '7'];
const MAX_ANNOUNCED = 10;
const AIRING_WINDOW_MS = 10 * MINUTE_MS;

const NEXT_OUTPUTS = [
  'found',
  'title',
  'episode',
  'episode_title',
  'full_title',
  'kind',
  'kind_name',
  'date',
  'time',
  'date_text',
  'days',
  'url',
  'text',
];
const WRITE_OUTPUTS = ['done', 'status', 'title', 'year', 'url', 'text'];

/**
 * @description The data of an item, as the scenes see it.
 * @param {object} item - An item.
 * @param {object} context - `{ today, language, timeZone }`.
 * @returns {object} Flat, scalar data.
 */
function itemData(item, { today, language, timeZone }) {
  const day = dayOf(item, timeZone);
  return {
    kind: item.kind,
    kind_name: kindName(item.kind, language),
    title: truncate(item.title, 200),
    episode: episodeCode(item),
    episode_title: truncate(item.episodeTitle ?? '', 200),
    full_title: truncate(fullTitle(item), 400),
    season: item.kind === 'episode' ? item.season : null,
    number: item.kind === 'episode' ? item.number : null,
    premiere: isPremiere(item),
    finale: isFinale(item),
    date: day,
    time: timeOf(item, timeZone),
    date_text: fullDate(day, language),
    days: daysBetween(today, day),
    network: truncate(item.network ?? '', 80),
    url: itemUrl(item),
  };
}

/**
 * @description The sentence about an item, by how far its day is.
 * @param {object} item - An item.
 * @param {object} context - `{ today, language, timeZone }`.
 * @returns {string} "Severance S02E05 airs tomorrow at 21:00."
 */
function itemSentence(item, { today, language, timeZone }) {
  const day = dayOf(item, timeZone);
  const days = daysBetween(today, day);
  const time = timeOf(item, timeZone);
  const values = { title: shortTitle(item), date: fullDate(day, language), time, days };
  const suffix =
    item.kind === 'episode' ? 'Episode' : item.kind === 'movie' ? 'Movie' : 'Streaming';
  let key = 'textInDays';
  if (days < 0) {
    key = 'textPast';
  } else if (days === 0) {
    key = 'textToday';
  } else if (days === 1) {
    key = 'textTomorrow';
  }
  return t(`${key}${suffix}`, language, values);
}

/**
 * @description The events of what a reading changed.
 * @param {object} result - `{ added, updated }` of the scanner.
 * @param {object} context - `{ config, today, language, timeZone }`.
 * @returns {{ trigger: string, data: object }[]} The events.
 */
function changeEvents(result, context) {
  const { config, today, language, timeZone } = context;
  const events = [];
  for (const { item, baseline } of result.added ?? []) {
    if (
      baseline ||
      !config.kinds.includes(item.kind) ||
      dayOf(item, timeZone) < today ||
      events.length >= MAX_ANNOUNCED
    ) {
      continue;
    }
    const data = itemData(item, context);
    events.push({
      trigger: TRIGGERS.ANNOUNCED,
      data: {
        ...data,
        text: truncate(
          t(`textAnnounced${item.kind === 'episode' ? 'Episode' : 'Movie'}`, language, {
            title: shortTitle(item),
            kind: data.kind_name,
            date: data.date_text,
          }),
          1000,
        ),
      },
    });
  }
  for (const { before, after } of result.updated ?? []) {
    const day = dayOf(after, timeZone);
    if (!config.kinds.includes(after.kind) || day < today) {
      continue;
    }
    const previous = dayOf(before, timeZone);
    const data = itemData(after, context);
    events.push({
      trigger: TRIGGERS.DATE_CHANGED,
      data: {
        ...data,
        previous_date: previous,
        previous_time: timeOf(before, timeZone),
        previous_date_text: fullDate(previous, language),
        text: truncate(
          t('textDateChanged', language, {
            title: shortTitle(after),
            date: [data.date_text, data.time].filter(Boolean).join(' '),
            previous: [fullDate(previous, language), timeOf(before, timeZone)]
              .filter(Boolean)
              .join(' '),
          }),
          1000,
        ),
      },
    });
  }
  return events;
}

/**
 * @description The "release day" events due now.
 * @param {object} options - `{ items, hour, wasFired, config, today, language, timeZone }`:
 * `hour` is the local hour (0–23).
 * @returns {{ trigger: string, data: object, key: string, until: number }[]}
 * The events; `key` and `until` go to the store once sent.
 */
function dueReleaseDays({ items, hour, wasFired, ...context }) {
  const { config, today, timeZone } = context;
  if (hour < config.notifyHour) {
    return [];
  }
  const due = [];
  for (const item of items) {
    if (!config.kinds.includes(item.kind)) {
      continue;
    }
    const day = dayOf(item, timeZone);
    for (const lead of LEADS) {
      if (addDays(day, -Number(lead)) !== today) {
        continue;
      }
      const key = `day|${item.id}|${lead}|${day}`;
      if (wasFired(key)) {
        continue;
      }
      due.push({
        trigger: TRIGGERS.DAY,
        data: {
          ...itemData(item, context),
          lead,
          text: truncate(itemSentence(item, context), 1000),
        },
        key,
        until: Date.parse(`${day}T00:00:00Z`) + 3 * DAY_MS,
      });
    }
  }
  return due.sort((a, b) => a.data.full_title.localeCompare(b.data.full_title));
}

/**
 * @description The "airs now" events due now.
 * @param {object} options - `{ items, now, wasFired, config, today, language, timeZone }`.
 * @returns {{ trigger: string, data: object, key: string, until: number }[]} The events.
 */
function dueAirings({ items, now, wasFired, ...context }) {
  const { config, language } = context;
  if (!config.kinds.includes('episode')) {
    return [];
  }
  const due = [];
  for (const item of items) {
    const at = item.at ? Date.parse(item.at) : NaN;
    if (!(at <= now && now - at < AIRING_WINDOW_MS)) {
      continue;
    }
    const key = `air|${item.id}|${item.at}`;
    if (wasFired(key)) {
      continue;
    }
    due.push({
      trigger: TRIGGERS.AIRING,
      data: {
        ...itemData(item, context),
        text: truncate(t('textAiring', language, { title: shortTitle(item) }), 1000),
      },
      key,
      until: at + 3 * DAY_MS,
    });
  }
  return due;
}

/**
 * @description The data of what is being watched.
 * @param {object} watched - An item of src/watching.js.
 * @param {object} context - `{ language, timeZone }`.
 * @returns {object} Flat, scalar data.
 */
function watchingData(watched, { language, timeZone }) {
  const start = Date.parse(watched.startedAt);
  const end = Date.parse(watched.expiresAt);
  return {
    kind: watched.kind,
    kind_name: kindName(watched.kind, language),
    title: truncate(watched.title, 200),
    episode: episodeCode(watched),
    episode_title: truncate(watched.episodeTitle ?? '', 200),
    full_title: truncate(fullTitle(watched), 400),
    season: watched.kind === 'episode' ? watched.season : null,
    number: watched.kind === 'episode' ? watched.number : null,
    year: watched.year,
    started_at: formatTime(start, timeZone),
    ends_at: formatTime(end, timeZone),
    runtime:
      Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / MINUTE_MS) : null,
    url: itemUrl(watched),
  };
}

/**
 * @description The events of a change of what is being watched.
 * @param {object} change - `{ started, stopped }` of the watcher.
 * @param {object} context - `{ language, timeZone }`.
 * @returns {{ trigger: string, data: object }[]} "stopped" first, then "started".
 */
function watchingEvents({ started, stopped }, context) {
  const events = [];
  if (stopped) {
    events.push({
      trigger: TRIGGERS.WATCHING_STOPPED,
      data: {
        ...watchingData(stopped.item, context),
        finished: String(stopped.finished),
        minutes: stopped.minutes,
        text: truncate(
          t(stopped.finished ? 'textWatchingFinished' : 'textWatchingStopped', context.language, {
            title: fullTitle(stopped.item),
          }),
          1000,
        ),
      },
    });
  }
  if (started) {
    events.push({
      trigger: TRIGGERS.WATCHING_STARTED,
      data: {
        ...watchingData(started, context),
        text: truncate(
          t('textWatchingStarted', context.language, { title: fullTitle(started) }),
          1000,
        ),
      },
    });
  }
  return events;
}

/**
 * @description The outputs of the `get_next` scene action.
 * @param {object|null} item - The item found.
 * @param {object} context - `{ today, language, timeZone }`.
 * @returns {object} Exactly NEXT_OUTPUTS.
 */
function nextOutputs(item, context) {
  if (!item) {
    return {
      found: false,
      title: '',
      episode: '',
      episode_title: '',
      full_title: '',
      kind: '',
      kind_name: '',
      date: '',
      time: '',
      date_text: '',
      days: -1,
      url: '',
      text: t('textNone', context.language),
    };
  }
  const data = itemData(item, context);
  return {
    found: true,
    title: data.title,
    episode: data.episode,
    episode_title: data.episode_title,
    full_title: data.full_title,
    kind: data.kind,
    kind_name: data.kind_name,
    date: data.date,
    time: data.time,
    date_text: data.date_text,
    days: data.days,
    url: data.url,
    text: truncate(itemSentence(item, context), 1000),
  };
}

export {
  TRIGGERS,
  LEADS,
  MAX_ANNOUNCED,
  AIRING_WINDOW_MS,
  NEXT_OUTPUTS,
  WRITE_OUTPUTS,
  itemData,
  itemSentence,
  changeEvents,
  dueReleaseDays,
  dueAirings,
  watchingData,
  watchingEvents,
  nextOutputs,
};
