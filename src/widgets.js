// -----------------------------------------------------------------------------
// Dashboard widgets (pure: also used by docs/illustrations/gen.mjs).
//
//   - `upcoming`      the next episodes and releases of the Trakt calendar, as
//                     a list (day, time, how far it is, badge, poster);
//   - `up_next`       the shows in progress: the next episode to watch and how
//                     many were watched;
//   - `now_watching`  what the account is watching: time left, start, end,
//                     poster; the last title watched when nothing plays.
// Settings: `kinds` (empty: every kept kind) and `count` for `upcoming`,
// `count` for `up_next`. Every text is multi-language: Gladys caches the
// content per language. Posters are served by onWidgetGetImage (src/images.js)
// and only shown once cached.
// -----------------------------------------------------------------------------

import { readKeys } from './config.js';
import { all, distanceText, each, kindName, t, truncate } from './i18n.js';
import {
  KINDS,
  dayOf,
  episodeCode,
  fullTitle,
  isFinale,
  isPremiere,
  itemUrl,
  shortTitle,
  timeOf,
  upcomingItems,
} from './items.js';
import { MINUTE_MS, formatTime, localClock, longDate, shortDate } from './time.js';

const WIDGETS = { UPCOMING: 'upcoming', UP_NEXT: 'up_next', WATCHING: 'now_watching' };
const COUNTS = [3, 5, 8];
const DEFAULT_COUNT = 5;
const KIND_COLORS = { episode: 'primary', movie: 'warning', streaming: 'info' };
// The lists change with a reading or at midnight, and a refresh is asked for
// then: the cache only bounds what a missed refresh costs.
const TTL_SECONDS = 900;
// The time left changes every minute.
const WATCHING_TTL_SECONDS = 60;

const choice = (raw, allowed, fallback) => (allowed.includes(Number(raw)) ? Number(raw) : fallback);

/**
 * @description The kinds a widget instance shows.
 * @param {object} settings - The widget settings.
 * @param {object} config - Normalized config.
 * @returns {string[]} Within the kept kinds.
 */
function widgetKinds(settings, config) {
  const kinds = readKeys(settings?.kinds, KINDS, []).filter((kind) => config.kinds.includes(kind));
  return kinds.length ? kinds : config.kinds;
}

/** The caption under the title: the account and the last reading. */
const sourceCaption = ({ fetchedAt, username, timeZone }) => ({
  type: 'text',
  variant: 'caption',
  text: fetchedAt
    ? all('sourceCaption', {
        user: truncate(username || '—', 40),
        time: formatTime(fetchedAt, timeZone),
      })
    : all('sourceCaptionNever'),
});

/**
 * @description The body shown when a widget has nothing to list.
 * @param {object} data - `{ linked, ready }`.
 * @param {object} nothing - The text when the account was read and nothing matches.
 * @returns {object} A text component.
 */
function emptyBody({ linked, ready }, nothing) {
  let text = nothing;
  if (!linked) {
    text = all('notLinked');
  } else if (!ready) {
    text = all('reading');
  }
  return { type: 'text', variant: 'body', text };
}

/**
 * @description "Fri 20 Nov 21:00 · in 6 days".
 * @param {object} item - An item.
 * @param {object} data - `{ today, timeZone }`.
 * @param {string} language - The language.
 * @returns {string} When it comes out.
 */
function whenText(item, { today, timeZone }, language) {
  const day = dayOf(item, timeZone);
  const time = timeOf(item, timeZone);
  return `${shortDate(day, language)}${time ? ` ${time}` : ''} · ${distanceText(day, today, language)}`;
}

/**
 * @description The badge of an item: premiere, finale, else its kind.
 * @param {object} item - An item.
 * @returns {object} `{ text, color }`.
 */
function badgeOf(item) {
  if (isPremiere(item)) {
    return { text: all('badgePremiere'), color: 'success' };
  }
  if (isFinale(item)) {
    return { text: all('badgeFinale'), color: 'danger' };
  }
  return {
    text: each((language) => truncate(kindName(item.kind, language), 16)),
    color: KIND_COLORS[item.kind],
  };
}

const withPoster = (card, key) => (key ? { ...card, image: key } : card);

/**
 * @description The `upcoming` widget.
 * @param {object} data - `{ items, today, timeZone, config, linked, ready, fetchedAt, username, posterKey, settings }`.
 * @returns {object} The widget content.
 */
function buildUpcomingWidget(data) {
  const { items, today, timeZone, config, posterKey, settings = {} } = data;
  const count = choice(settings.count, COUNTS, DEFAULT_COUNT);
  const list = upcomingItems(items, {
    today,
    timeZone,
    kinds: widgetKinds(settings, config),
  }).slice(0, count);
  const caption = sourceCaption(data);
  if (list.length === 0) {
    return { ttl_seconds: TTL_SECONDS, components: [caption, emptyBody(data, all('noUpcoming'))] };
  }
  return {
    ttl_seconds: TTL_SECONDS,
    components: [
      caption,
      {
        type: 'card-list',
        display: 'list',
        items: list.map((item) =>
          withPoster(
            {
              title: truncate(shortTitle(item), 60),
              // A list shows the date OR the subtitle: the day goes in the subtitle.
              subtitle: each((language) => truncate(whenText(item, data, language), 60)),
              badge: badgeOf(item),
              description: each((language) =>
                truncate(
                  [
                    fullTitle(item),
                    kindName(item.kind, language),
                    [
                      `${longDate(dayOf(item, timeZone), language)} ${dayOf(item, timeZone).slice(0, 4)}`,
                      timeOf(item, timeZone),
                    ]
                      .filter(Boolean)
                      .join(' · '),
                    item.network,
                  ]
                    .filter(Boolean)
                    .join('\n'),
                  2000,
                ),
              ),
              links: [{ url: itemUrl(item), label: all('linkTrakt') }],
            },
            posterKey?.(item.poster),
          ),
        ),
      },
    ],
  };
}

/**
 * @description The `up_next` widget.
 * @param {object} data - Same as `buildUpcomingWidget`, plus `upNext`.
 * @returns {object} The widget content.
 */
function buildUpNextWidget(data) {
  const { upNext = [], posterKey, settings = {} } = data;
  const count = choice(settings.count, COUNTS, DEFAULT_COUNT);
  const list = upNext.slice(0, count);
  const caption = sourceCaption(data);
  if (list.length === 0) {
    return { ttl_seconds: TTL_SECONDS, components: [caption, emptyBody(data, all('noUpNext'))] };
  }
  return {
    ttl_seconds: TTL_SECONDS,
    components: [
      caption,
      {
        type: 'card-list',
        display: 'list',
        items: list.map((show) => {
          const left = Math.max(0, show.aired - show.completed);
          return withPoster(
            {
              title: truncate(show.title, 60),
              subtitle: truncate(
                [episodeCode(show), show.episodeTitle].filter(Boolean).join(' · '),
                60,
              ),
              badge: {
                text: `${show.completed}/${show.aired}`,
                color: left <= 1 ? 'success' : 'primary',
              },
              description: each((language) =>
                truncate(
                  [
                    fullTitle(show),
                    t('detailWatched', language, { completed: show.completed, aired: show.aired }),
                    t('detailLeft', language, { left }),
                  ].join('\n'),
                  2000,
                ),
              ),
              links: [{ url: itemUrl(show), label: all('linkTrakt') }],
            },
            posterKey?.(show.poster),
          );
        }),
      },
    ],
  };
}

/**
 * @description The `now_watching` widget.
 * @param {object} data - Same as `buildUpcomingWidget`, plus `watching`
 * (`{ current, last }`) and `now`.
 * @returns {object} The widget content.
 */
function buildWatchingWidget(data) {
  const { watching = {}, now, timeZone, config, posterKey } = data;
  const { current, last } = watching;
  if (!config.watching || !data.linked) {
    return {
      ttl_seconds: TTL_SECONDS,
      components: [
        { type: 'text', variant: 'body', text: all(data.linked ? 'watchingOff' : 'notLinked') },
      ],
    };
  }
  if (!current) {
    const components = [{ type: 'text', variant: 'body', text: all('nothingPlaying') }];
    if (last) {
      const stopped = Date.parse(last.stoppedAt);
      components.push({
        type: 'status',
        items: [
          { label: all('statusLast'), value: truncate(fullTitle(last), 40), color: 'neutral' },
          {
            label: all('statusStopped'),
            value: each((language) =>
              truncate(
                `${shortDate(localClock(stopped, timeZone).date, language)} ${formatTime(stopped, timeZone)}`,
                40,
              ),
            ),
            color: 'neutral',
          },
        ],
      });
    }
    return { ttl_seconds: WATCHING_TTL_SECONDS, components };
  }
  const start = Date.parse(current.startedAt);
  const end = Date.parse(current.expiresAt);
  const left = Number.isFinite(end) ? Math.max(0, Math.round((end - now) / MINUTE_MS)) : null;
  const components = [
    { type: 'text', variant: 'heading', text: truncate(fullTitle(current), 60) },
    {
      type: 'value',
      value: left === null ? '—' : all('minutes', { minutes: left }),
      label: all('tileLeft'),
      icon: 'clock',
      color: 'primary',
    },
    {
      type: 'value',
      value: formatTime(start, timeZone) || '—',
      label: all('tileStarted'),
      icon: 'play',
    },
    {
      type: 'value',
      value: formatTime(end, timeZone) || '—',
      label: all('tileEnds'),
      icon: 'flag',
    },
  ];
  const poster = posterKey?.(current.poster);
  if (poster) {
    components.push({
      type: 'image',
      key: poster,
      alt: each((language) => truncate(t('posterAlt', language, { title: current.title }), 100)),
      fit: 'contain',
    });
  }
  components.push({
    type: 'button',
    label: all('linkTrakt'),
    icon: 'external-link',
    style: 'secondary',
    link: { url: itemUrl(current) },
  });
  return { ttl_seconds: WATCHING_TTL_SECONDS, components };
}

export {
  WIDGETS,
  COUNTS,
  DEFAULT_COUNT,
  KIND_COLORS,
  widgetKinds,
  buildUpcomingWidget,
  buildUpNextWidget,
  buildWatchingWidget,
};
