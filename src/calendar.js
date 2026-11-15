// -----------------------------------------------------------------------------
// The Trakt calendar in the Gladys calendar (manifest `type: "calendar"`).
//
// Every user who enabled the integration in "My calendars" gets one calendar,
// "Shows and movies", fed by the Trakt account of the household:
//   - an episode is an event at its airing time, as long as its runtime;
//   - a movie release or a streaming release is an all-day event.
// A window covers what is kept (7 days back, `days_ahead` days ahead): an item
// Trakt drops (a show removed from the watchlist, an episode rescheduled out
// of the window) disappears from Gladys too. The calendar is private when
// created: the user shares it with the household (and the scenes) from "My
// calendars".
//
// Limits of the core: 500 events per request, 30 calendar writes per minute
// per integration (writes are spaced by 2.1 s).
//
// External ids: ext:<selector>:<user>:watch        (calendar)
//               ext:<selector>:<user>:<item id>    (event)
// -----------------------------------------------------------------------------

import { kindName, t, truncate } from './i18n.js';
import { byDate, dayOf, fullTitle, itemUrl } from './items.js';
import { BACK_DAYS } from './scan.js';
import { MINUTE_MS, addDays } from './time.js';

export const CALENDAR_KEY = 'watch';
export const CALENDAR_COLOR = '#ed1c24';
export const MAX_EVENTS_PER_REQUEST = 500;
export const WRITE_SPACING_MS = 2100;

/**
 * @description The external id of the calendar of a user.
 * @param {object} gladys - SDK client.
 * @param {string} user - User selector.
 * @returns {string} The external id.
 */
export function calendarId(gladys, user) {
  return gladys.externalId(`${user}:${CALENDAR_KEY}`);
}

/**
 * @description The calendar event of an item.
 * @param {object} gladys - SDK client.
 * @param {string} user - User selector.
 * @param {object} item - An item.
 * @param {string} language - The user's language.
 * @returns {object} The event (the end of an all-day event is exclusive).
 */
export function buildEvent(gladys, user, item, language) {
  const details = [kindName(item.kind, language), item.network].filter(Boolean).join(' · ');
  const event = {
    external_id: gladys.externalId(`${user}:${item.id}`),
    name: truncate(fullTitle(item), 200),
    description: truncate(t('eventFooter', language, { details }), 1000),
    url: itemUrl(item),
  };
  if (item.at) {
    const start = Date.parse(item.at);
    return {
      ...event,
      start: item.at,
      end: new Date(start + item.runtime * (item.count ?? 1) * MINUTE_MS).toISOString(),
      full_day: false,
    };
  }
  return { ...event, start: item.date, end: addDays(item.date, 1), full_day: true };
}

/**
 * @description Create the calendar synchronizer.
 * @param {object} gladys - SDK client.
 * @param {object} options - Dependencies.
 * @param {Function} options.config - `() => normalized config`.
 * @param {Function} options.items - `() => every item kept`.
 * @param {Function} options.ready - `() => boolean`: the account was read at
 * least once (an empty calendar would otherwise erase the events of a restart).
 * @param {Function} options.today - `() => 'YYYY-MM-DD'`.
 * @param {string} [options.timeZone] - Timezone of the instance.
 * @param {Function} [options.sleep] - Delay between two writes.
 * @param {object} [options.logger] - SDK logger.
 * @returns {{ syncAll: Function, syncUser: Function, forget: Function }} The synchronizer.
 */
export function createCalendarSync(
  gladys,
  { config, items, ready, today, timeZone, sleep = defaultSleep, logger },
) {
  // Last content pushed per calendar: an unchanged calendar is not pushed again.
  const pushed = new Map();
  let lastWrite = 0;
  let queue = Promise.resolve();

  const write = async (call) => {
    const wait = lastWrite + WRITE_SPACING_MS - Date.now();
    if (wait > 0) {
      await sleep(wait);
    }
    lastWrite = Date.now();
    return call();
  };

  const syncAccount = async (account, { force = false } = {}) => {
    const user = account.user.selector;
    const language = account.user.language;
    const id = calendarId(gladys, user);
    const calendars = [
      {
        external_id: id,
        name: t('calendarName', language),
        description: t('calendarDescription', language),
        color: CALENDAR_COLOR,
      },
    ];
    const calendarsKey = JSON.stringify(calendars);
    if (force || pushed.get(`calendars:${user}`) !== calendarsKey) {
      await write(() => gladys.publishCalendars(user, calendars));
      pushed.set(`calendars:${user}`, calendarsKey);
    }
    if (!ready()) {
      return;
    }
    const mine = (await gladys.getCalendars(user)).find((calendar) => calendar.external_id === id);
    if (mine && !mine.sync) {
      return;
    }
    const { kinds, daysAhead } = config();
    const from = addDays(today(), -BACK_DAYS);
    const to = addDays(today(), daysAhead + 1);
    const events = items()
      .filter(
        (item) =>
          kinds.includes(item.kind) && dayOf(item, timeZone) >= from && dayOf(item, timeZone) < to,
      )
      .sort(byDate(timeZone))
      .slice(0, MAX_EVENTS_PER_REQUEST)
      .map((item) => buildEvent(gladys, user, item, language));
    // A day more on each side: the window is given in days, the episodes in
    // instants, and the local day of an instant may be the UTC day before or after.
    const window = { from: addDays(from, -1), to: addDays(to, 1) };
    const content = JSON.stringify([window, events]);
    if (!force && pushed.get(id) === content) {
      return;
    }
    try {
      await write(() => gladys.publishCalendarEvents(id, events, window));
      pushed.set(id, content);
    } catch (error) {
      // The user turned the sync of this calendar off meanwhile.
      if (error?.status === 403) {
        logger?.info(`calendar of ${user} not synchronized: ${error.message}`);
        return;
      }
      throw error;
    }
  };

  const enqueue = (job) => {
    const result = queue.then(job);
    queue = result.catch((error) => logger?.warn(`calendar sync failed: ${error.message}`));
    return result;
  };

  return {
    /**
     * @param {object} [options] - `{ force }`: push even what did not change.
     * @returns {Promise<void>} Every enabled user synchronized.
     */
    syncAll: (options) =>
      enqueue(async () => {
        for (const account of await gladys.getCalendarAccounts()) {
          await syncAccount(account, options);
        }
      }),
    /**
     * @param {string} userSelector - The user whose account changed.
     * @returns {Promise<void>} That user synchronized (nothing if disabled).
     */
    syncUser: (userSelector) =>
      enqueue(async () => {
        const account = (await gladys.getCalendarAccounts()).find(
          (candidate) => candidate.user.selector === userSelector,
        );
        if (account) {
          await syncAccount(account, { force: true });
        } else {
          // Disabled: the core already deleted the calendar.
          pushed.delete(calendarId(gladys, userSelector));
          pushed.delete(`calendars:${userSelector}`);
        }
      }),
    /** Forget what was pushed (reconnection: the core may have changed meanwhile). */
    forget: () => pushed.clear(),
  };
}

/**
 * @param {number} ms - Delay.
 * @returns {Promise<void>} Resolved after the delay.
 */
function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}
