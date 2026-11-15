// -----------------------------------------------------------------------------
// The integration: every Gladys handler, registered before connect().
//
// A calendar integration (manifest `type: "calendar"`): one "Shows and movies"
// calendar for every user who enabled it (src/calendar.js), fed by the Trakt
// account of the household; three widgets, seven scene triggers, three scene
// actions and two configuration buttons (read again, disconnect).
//
// The account is linked with the Connect button of the configuration (an
// `account_link` field): the device code flow of src/auth.js. The code to
// type on trakt.tv is shown in the connection status.
//
// A one-minute tick drives everything: it renews the tokens, asks what is
// being watched, sends the "release day" and "airs now" events that are due,
// slides the calendar window at midnight and starts a reading of the account
// when one is due (src/scan.js). A reading runs in the background; its
// changes fire the scene triggers, then the calendars, the posters and the
// widgets follow. The tests drive it with the fake Gladys of the SDK, a fake
// Trakt and a clock moved by hand (test/app.test.js).
// -----------------------------------------------------------------------------

import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import { AuthError, createTokenManager, requestDeviceCode, waitForApproval } from './auth.js';
import { createCalendarSync } from './calendar.js';
import { ACCOUNT_FIELD, INTERNAL_KEYS, normalizeConfig, readKeys, textLanguage } from './config.js';
import {
  NEXT_OUTPUTS,
  TRIGGERS,
  WRITE_OUTPUTS,
  changeEvents,
  dueAirings,
  dueReleaseDays,
  nextOutputs,
  watchingEvents,
} from './events.js';
import { all, t, truncate } from './i18n.js';
import { createImages } from './images.js';
import { KINDS, SITE, fullTitle, sameTitle, upcomingItems } from './items.js';
import { createScanner } from './scan.js';
import { createStore } from './store.js';
import { HOUR_MS, MINUTE_MS, formatTime, localClock } from './time.js';
import { TraktError, createTraktClient } from './trakt.js';
import { createWatcher } from './watching.js';
import { WIDGETS, buildUpNextWidget, buildUpcomingWidget, buildWatchingWidget } from './widgets.js';

const ACTIONS = { REFRESH: 'refresh', DISCONNECT: 'disconnect' };
const SCENE_ACTIONS = {
  NEXT: 'get_next',
  WATCHLIST: 'add_to_watchlist',
  WATCHED: 'mark_watched',
};
const TICK_MS = MINUTE_MS;
const WIDGET_REFRESH_SPACING_MS = 11 * 1000;
const POSTERS_PER_LIST = 12;
// Trakt does not check that a play is new: the same title is not marked twice within an hour.
const WRITE_GUARD_MS = HOUR_MS;
const SEARCH_SPECIALS = /([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g;

/**
 * @description Wire the integration.
 * @param {object} gladys - SDK client (or the fake one of the tests).
 * @param {object} [deps] - Dependencies, replaced in the tests.
 * @param {Function} [deps.fetchImpl] - fetch, for Trakt (API and sign-in).
 * @param {object} [deps.store] - State file (src/store.js).
 * @param {object} [deps.images] - Posters (src/images.js).
 * @param {Function} [deps.now] - Clock, in ms.
 * @param {string} [deps.timeZone] - Timezone of the instance (TZ by default).
 * @param {Function} [deps.sleep] - Delay between calendar writes and API calls.
 * @param {string} [deps.userAgent] - Sent to Trakt.
 * @param {object} [deps.logger] - SDK logger.
 * @returns {object} `{ start, stop, tick, scan, idle, store }`.
 */
export function createApp(gladys, deps = {}) {
  const {
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    timeZone = process.env.TZ || undefined,
    sleep,
    userAgent = 'gladys-trakt (+https://github.com/William-De71/gladys-trakt)',
    logger = sdkLogger,
  } = deps;
  let config = normalizeConfig(gladys.config ?? {});
  const store = deps.store ?? createStore({ logger });
  const images =
    deps.images ??
    createImages({ store, fetch: fetchImpl, userAgent, now, logger, ...(sleep ? { sleep } : {}) });

  let timer = null;
  let stopped = false;
  let today = null;
  let ticking = null;
  let scanning = null;
  let polling = null;
  let lastConnection = null;
  let signature = null;
  let authLost = false;
  let emptied = false;
  let signIn = null; // { userCode, url } while a code waits for its approval
  let signInGeneration = 0;
  let signInFailure = null;
  let waiting = null;
  const lastWidgetRefresh = new Map();
  const pendingWidgetRefresh = new Map();
  const recentWrites = new Map();

  const tokens = createTokenManager({
    fetchImpl,
    now,
    userAgent,
    getClientId: () => config.clientId,
    saveTokens: async (next) => {
      config = { ...config, tokens: { ...next } };
      await gladys.setConfig({
        [INTERNAL_KEYS.accessToken]: next.accessToken,
        [INTERNAL_KEYS.refreshToken]: next.refreshToken,
        [INTERNAL_KEYS.expiresAt]: String(next.expiresAt),
      });
    },
  });
  tokens.setTokens(config.tokens);

  const client = createTraktClient({
    tokens,
    getClientId: () => config.clientId,
    fetchImpl,
    userAgent,
    now,
    ...(sleep ? { sleep } : {}),
  });

  const currentDay = () => localClock(now(), timeZone).date;
  const language = () => textLanguage(config);
  const linked = () => Boolean(config.clientId) && tokens.hasGrant() && !authLost;
  const context = () => ({ config, today: currentDay(), language: language(), timeZone });

  const scanner = createScanner({
    client,
    store,
    config: () => config,
    linked,
    today: currentDay,
    now,
    timeZone,
    logger,
  });

  const watcher = createWatcher({ client, store, now });

  const calendarSync = createCalendarSync(gladys, {
    config: () => config,
    items: () => store.items(),
    ready: () => Boolean(store.data.scan.at) || emptied,
    today: currentDay,
    timeZone,
    sleep,
    logger,
  });

  const safely = async (call) => {
    try {
      return await call();
    } catch (error) {
      logger.warn(error.message);
      return undefined;
    }
  };

  const upcoming = (filters = {}) =>
    upcomingItems(store.items(), {
      today: currentDay(),
      timeZone,
      kinds: config.kinds,
      ...filters,
    });

  // --- Publications ------------------------------------------------------------

  const refreshWidget = (key) => {
    const wait = (lastWidgetRefresh.get(key) ?? 0) + WIDGET_REFRESH_SPACING_MS - Date.now();
    if (wait <= 0) {
      lastWidgetRefresh.set(key, Date.now());
      safely(() => gladys.requestWidgetRefresh(key));
      return;
    }
    if (!pendingWidgetRefresh.has(key)) {
      const pending = setTimeout(() => {
        pendingWidgetRefresh.delete(key);
        refreshWidget(key);
      }, wait);
      pending.unref?.();
      pendingWidgetRefresh.set(key, pending);
    }
  };

  const refreshWidgets = () => Object.values(WIDGETS).forEach(refreshWidget);

  const connectionStatus = () => {
    if (!config.clientId) {
      return { connected: false, message: all('statusNoClient') };
    }
    if (signIn) {
      return {
        connected: false,
        message: all('statusEnterCode', { code: signIn.userCode, url: signIn.url }),
      };
    }
    if (authLost) {
      return { connected: false, message: all('statusReconnect') };
    }
    if (!tokens.hasGrant()) {
      return {
        connected: false,
        message: all(signInFailure ? `statusSignIn_${signInFailure}` : 'statusNotLinked'),
      };
    }
    const { at, error } = store.data.scan;
    const user = truncate(store.data.account.username || '—', 40);
    if (client.pausedUntil) {
      return {
        connected: true,
        message: all('statusPaused', { time: formatTime(client.pausedUntil, timeZone) }),
      };
    }
    if (error?.kind === 'forbidden') {
      return { connected: false, message: all('statusForbidden') };
    }
    if (error && error.kind !== 'rate') {
      return {
        connected: false,
        message: all('statusUnreachable', { error: truncate(error.message, 80) }),
      };
    }
    if (!at) {
      return { connected: true, message: all('statusReading') };
    }
    return {
      connected: true,
      message: all('statusOk', { user, upcoming: upcoming().length }),
    };
  };

  const publishConnection = async () => {
    const status = connectionStatus();
    const message = Object.fromEntries(
      Object.entries(status.message).map(([lang, text]) => [lang, truncate(text, 200)]),
    );
    const key = JSON.stringify([status.connected, message]);
    if (key !== lastConnection) {
      await gladys.setConnectionStatus(status.connected, message);
      lastConnection = key;
    }
  };

  const publishAll = async () => {
    if (!gladys.connected) {
      return;
    }
    await safely(() => calendarSync.syncAll());
    await safely(() => publishConnection());
    refreshWidgets();
  };

  /** Cache the posters of what the widgets can show. */
  const cachePosters = async () => {
    const urls = [
      store.data.watching.current?.poster,
      ...upcoming()
        .slice(0, POSTERS_PER_LIST)
        .map((item) => item.poster),
      ...store
        .upNext()
        .slice(0, POSTERS_PER_LIST)
        .map((show) => show.poster),
    ].filter(Boolean);
    if (await safely(() => images.cache(urls))) {
      refreshWidgets();
    }
  };

  // --- Account -------------------------------------------------------------------

  /** Trakt refuses the sign-in for good: say it once, wait for a new Connect. */
  const loseAccount = async (reason) => {
    if (authLost) {
      return;
    }
    authLost = true;
    logger.warn(`Trakt sign-in lost (${reason}): click Connect again in the configuration`);
    lastConnection = null;
    if (gladys.connected) {
      await safely(() =>
        gladys.publishSceneEvent(TRIGGERS.DISCONNECTED, {
          text: t('textDisconnected', language()),
        }),
      );
      await safely(() => publishConnection());
    }
    refreshWidgets();
  };

  const renewTokens = async () => {
    if (!config.clientId || authLost || !tokens.dueForRefresh()) {
      return;
    }
    try {
      await tokens.refresh();
    } catch (error) {
      if (error instanceof AuthError && error.reauth) {
        await loseAccount(error.message);
      } else {
        logger.warn(error.message);
      }
    }
  };

  // --- Reading -------------------------------------------------------------------

  /**
   * @description Read the account in the background, one reading at a time.
   * @returns {Promise<object|undefined>} The result of the scanner.
   */
  const scan = () => {
    if (!scanning) {
      scanning = (async () => {
        if (gladys.connected) {
          await safely(() => publishConnection());
        }
        const result = await scanner.run();
        if (store.data.scan.error?.kind === 'auth') {
          await loseAccount(store.data.scan.error.message);
        }
        if (gladys.connected) {
          for (const event of changeEvents(result, context())) {
            await safely(() => gladys.publishSceneEvent(event.trigger, event.data));
          }
        }
        await publishAll();
        if (!stopped) {
          await cachePosters();
        }
        return result;
      })()
        .catch((error) => {
          logger.warn(`reading failed: ${error.message}`);
          return undefined;
        })
        .finally(() => {
          scanning = null;
        });
    }
    return scanning;
  };

  /** Ask what is being watched, one request at a time. */
  const pollWatching = () => {
    if (!polling) {
      polling = (async () => {
        const change = await watcher.poll();
        if (gladys.connected) {
          for (const event of watchingEvents(change, context())) {
            await safely(() => gladys.publishSceneEvent(event.trigger, event.data));
          }
        }
        if (change.changed) {
          refreshWidget(WIDGETS.WATCHING);
          if (store.data.watching.current?.poster && !stopped) {
            await cachePosters();
          }
        }
      })()
        .catch(async (error) => {
          if (error instanceof TraktError && error.kind === 'auth') {
            await loseAccount(error.message);
          } else {
            logger.debug?.(`watching: ${error.message}`);
          }
        })
        .finally(() => {
          polling = null;
        });
    }
    return polling;
  };

  // --- The tick ------------------------------------------------------------------

  const runTick = async () => {
    const clock = localClock(now(), timeZone);
    const dayChanged = today !== null && clock.date !== today;
    today = clock.date;
    await renewTokens();
    if (gladys.connected && store.data.scan.at && linked()) {
      const due = [
        ...dueAirings({
          items: store.items(),
          now: now(),
          wasFired: (key) => store.wasFired(key),
          ...context(),
        }),
        ...dueReleaseDays({
          items: store.items(),
          hour: Math.floor(clock.minutes / 60),
          wasFired: (key) => store.wasFired(key),
          ...context(),
        }),
      ];
      for (const event of due) {
        await safely(() => gladys.publishSceneEvent(event.trigger, event.data));
        store.markFired(event.key, event.until);
      }
      store.pruneFired(now());
    }
    if (config.watching && linked() && !client.pausedUntil) {
      await pollWatching();
    }
    if (dayChanged) {
      await publishAll();
    } else if (gladys.connected) {
      await safely(() => publishConnection());
    }
    if (scanner.due()) {
      scan();
    }
  };

  /** One tick at a time. */
  const tick = () => {
    if (!ticking) {
      ticking = runTick()
        .catch((error) => logger.warn(`tick failed: ${error.message}`))
        .finally(() => {
          ticking = null;
        });
    }
    return ticking;
  };

  // --- Language ----------------------------------------------------------------

  const rememberLanguage = (lang) => {
    if (typeof lang !== 'string' || !/^[a-z]{2}$/.test(lang) || lang === config.lastLanguage) {
      return;
    }
    config = { ...config, lastLanguage: lang };
    gladys
      .setConfig({ [INTERNAL_KEYS.language]: lang })
      .catch((error) => logger.warn(`unable to store the language: ${error.message}`));
  };

  // --- Configuration ---------------------------------------------------------------

  /** What makes a new reading necessary when it changes. */
  const readingSignature = () =>
    JSON.stringify([config.clientId, config.kinds, config.daysAhead, config.specials]);

  /** Forget the account: tokens, what was read, the pending sign-in. */
  const forgetAccount = async () => {
    signInGeneration += 1;
    signIn = null;
    signInFailure = null;
    authLost = false;
    await tokens.clear();
    store.clearAccount();
    watcher.reset();
    emptied = true;
    lastConnection = null;
  };

  const applyConfig = async (fallback) => {
    const before = config.clientId;
    try {
      // The whole configuration, internal keys (the tokens) included.
      config = normalizeConfig((await gladys.getConfig()) ?? fallback ?? {});
      tokens.setTokens(config.tokens);
    } catch (error) {
      // Keep the tokens in memory: the fallback may not carry the internal keys.
      logger.warn(`unable to read the configuration: ${error.message}`);
      config = { ...normalizeConfig(fallback ?? {}), tokens: config.tokens };
    }
    if (signature !== null && before && before !== config.clientId && tokens.hasGrant()) {
      // The tokens belong to the previous Trakt app.
      await safely(() => forgetAccount());
    }
    if (!config.watching) {
      watcher.reset();
    }
    lastConnection = null;
    const next = readingSignature();
    const changed = signature !== null && signature !== next;
    signature = next;
    if (changed) {
      // More kinds or days: what they bring was not just announced by Trakt.
      store.data.scan.quiet = true;
    }
    await publishAll();
    if (changed) {
      scan();
    } else {
      tick();
    }
  };

  gladys.on('connected', async () => {
    // Calendars may have changed while disconnected: push everything again.
    calendarSync.forget();
    await applyConfig(gladys.config ?? {});
    logger.info(`connected, Trakt account ${linked() ? 'linked' : 'not linked'}`);
  });

  gladys.onConfigUpdated(async (raw) => {
    await applyConfig(raw);
  });

  gladys.onCalendarAccountUpdated(async (userSelector) => {
    await calendarSync.syncUser(userSelector);
  });

  // --- Sign-in (device code flow) ----------------------------------------------------

  gladys.onOAuthAuthorizeUrl(async (key) => {
    if (key !== ACCOUNT_FIELD) {
      throw new Error(`Unknown account field: ${key}`);
    }
    if (!config.clientId) {
      throw new Error(t('statusNoClient', language()));
    }
    let code;
    try {
      code = await requestDeviceCode({ clientId: config.clientId, fetchImpl, userAgent });
    } catch (error) {
      logger.error(`Trakt sign-in could not start: ${error.message}`);
      throw new Error(
        t(error.code === 'invalid_client' ? 'signInBadClient' : 'signInStartFailed', language(), {
          reason: truncate(error.message, 120),
        }),
        { cause: error },
      );
    }
    signInGeneration += 1;
    const mine = signInGeneration;
    signIn = { userCode: code.userCode, url: code.verificationUrl.replace(/^https:\/\//, '') };
    signInFailure = null;
    logger.info(
      `Trakt sign-in: type the code shown in the connection status on ${code.verificationUrl} (valid ${Math.round(code.expiresIn / 60)} min)`,
    );
    lastConnection = null;
    await safely(() => publishConnection());
    waiting = waitForApproval({
      clientId: config.clientId,
      code,
      fetchImpl,
      userAgent,
      now,
      ...(sleep ? { sleep } : {}),
      cancelled: () => mine !== signInGeneration || stopped,
    })
      .then(async (next) => {
        if (!next || mine !== signInGeneration) {
          return;
        }
        // Another account may be signing in: start from nothing.
        store.clearAccount();
        watcher.reset();
        await tokens.adopt(next);
        signIn = null;
        authLost = false;
        emptied = false;
        lastConnection = null;
        logger.info('Signed in to Trakt');
        await scan();
      })
      .catch(async (error) => {
        if (mine !== signInGeneration) {
          return;
        }
        logger.error(`Trakt sign-in failed: ${error.message}`);
        signIn = null;
        signInFailure = ['denied', 'expired'].includes(error.code) ? error.code : 'other';
        lastConnection = null;
        await safely(() => publishConnection());
      });
    return code.verificationUrl;
  });

  // --- Configuration buttons ---------------------------------------------------------

  gladys.onAction(ACTIONS.REFRESH, async () => {
    if (!linked()) {
      return all(authLost ? 'statusReconnect' : 'statusNotLinked');
    }
    if (scanner.running || scanning) {
      return all('refreshRunning');
    }
    const result = await scan();
    const { error } = store.data.scan;
    if (!result?.ok && error) {
      return all('refreshFailed', { error: truncate(error.message, 100) });
    }
    return all('refreshed', { upcoming: upcoming().length, shows: store.upNext().length });
  });

  gladys.onAction(ACTIONS.DISCONNECT, async () => {
    await forgetAccount();
    await publishAll();
    return all('disconnected');
  });

  // --- Widgets -------------------------------------------------------------------

  const widgetData = (settings) => ({
    items: store.items(),
    upNext: store.upNext(),
    watching: store.data.watching,
    today: currentDay(),
    now: now(),
    timeZone,
    config,
    linked: linked(),
    ready: Boolean(store.data.scan.at),
    fetchedAt: store.data.scan.okAt || store.data.scan.at || 0,
    username: store.data.account.username ?? '',
    posterKey: images.keyIfReady,
    settings: settings ?? {},
  });

  const widget = (key, build) =>
    gladys.onWidgetGet(key, async ({ settings, language: lang }) => {
      rememberLanguage(lang);
      return build(widgetData(settings));
    });
  widget(WIDGETS.UPCOMING, buildUpcomingWidget);
  widget(WIDGETS.UP_NEXT, buildUpNextWidget);
  widget(WIDGETS.WATCHING, buildWatchingWidget);

  gladys.onWidgetGetImage(async (key) => images.get(key));

  // --- Scene actions ---------------------------------------------------------------

  const requireLink = () => {
    if (!linked()) {
      throw new Error(t(authLost ? 'statusReconnect' : 'statusNotLinked', language()));
    }
  };

  gladys.onSceneAction(SCENE_ACTIONS.NEXT, async (fields = {}) => {
    const kinds = readKeys(fields?.kind, KINDS, []).filter((kind) => config.kinds.includes(kind));
    const title = typeof fields?.title === 'string' ? fields.title.trim() : '';
    const [item] = upcoming({
      kinds: kinds.length ? kinds : config.kinds,
      ...(title ? { title } : {}),
    });
    return nextOutputs(item ?? null, context());
  });

  /**
   * @description Find a movie or a show on Trakt from what the user typed.
   * @param {string} type - `movie` or `show`.
   * @param {string} typed - A title ("Dune", "Dune (2021)"), an IMDb
   * identifier or the address of its page on trakt.tv.
   * @returns {Promise<object|null>} `{ ids, title, year, slug }`, null when not found.
   */
  const findTitle = async (type, typed) => {
    const query = String(typed ?? '').trim();
    const page = /trakt\.tv\/(movies|shows)\/([a-z0-9-]+)/i.exec(query);
    if (page && page[1].toLowerCase() === `${type}s`) {
      const slug = page[2].toLowerCase();
      return { ids: { slug }, title: slug, year: null, slug };
    }
    const imdb = /\btt\d{6,10}\b/.exec(query);
    let results;
    let wanted = query;
    let year = null;
    if (imdb) {
      results = await client.lookup(imdb[0], type);
    } else {
      const dated = /^(.*\S)\s+\((\d{4})\)$/.exec(query);
      if (dated) {
        wanted = dated[1];
        year = Number(dated[2]);
      }
      results = await client.search(type, wanted.replace(SEARCH_SPECIALS, '\\$1'));
    }
    const found = (Array.isArray(results) ? results : [])
      .map((result) => result?.[type])
      .filter((entry) => Number.isInteger(entry?.ids?.trakt));
    const pick =
      (imdb ? found[0] : null) ??
      found.find(
        (entry) => sameTitle(entry.title ?? '', wanted) && (!year || entry.year === year),
      ) ??
      found.find((entry) => !year || entry.year === year) ??
      null;
    if (!pick) {
      return null;
    }
    return {
      ids: { trakt: pick.ids.trakt },
      title: String(pick.title ?? ''),
      year: Number.isInteger(pick.year) ? pick.year : null,
      slug: String(pick.ids.slug ?? pick.ids.trakt),
    };
  };

  const writeResult = (status, key, values, found = null, path = 'movies') => {
    const outputs = {
      done: ['added', 'marked'].includes(status),
      status,
      title: truncate(found?.title ?? '', 200),
      year: found?.year ?? -1,
      url: found ? `${SITE}/${path}/${encodeURIComponent(found.slug)}` : '',
      text: truncate(t(key, language(), values), 1000),
    };
    return Object.fromEntries(WRITE_OUTPUTS.map((name) => [name, outputs[name]]));
  };

  /** After a write: the next reading is a baseline, and it starts now. */
  const readQuietly = () => {
    store.data.scan.quiet = true;
    store.changed();
    scan();
  };

  const guarded = async (call) => {
    try {
      return await call();
    } catch (error) {
      if (error instanceof TraktError && error.kind === 'auth') {
        await loseAccount(error.message);
        throw new Error(t('statusReconnect', language()), { cause: error });
      }
      throw error;
    }
  };

  gladys.onSceneAction(SCENE_ACTIONS.WATCHLIST, async (fields = {}) => {
    requireLink();
    const type = fields?.type === 'show' ? 'show' : 'movie';
    const path = `${type}s`;
    const typed = String(fields?.title ?? '').trim();
    return guarded(async () => {
      const found = typed ? await findTitle(type, typed) : null;
      if (!found) {
        return writeResult('not_found', 'writeNotFound', { query: truncate(typed, 100) });
      }
      let answer;
      try {
        answer = await client.addToWatchlist({ [path]: [{ ids: found.ids }] });
      } catch (error) {
        if (error instanceof TraktError && error.kind === 'limit') {
          return writeResult('limit', 'writeLimit', {}, found, path);
        }
        throw error;
      }
      const values = { title: found.title };
      if (answer?.added?.[path] > 0) {
        readQuietly();
        return writeResult('added', 'writeAdded', values, found, path);
      }
      if (answer?.existing?.[path] > 0) {
        return writeResult('existing', 'writeExisting', values, found, path);
      }
      return writeResult('not_found', 'writeNotFound', { query: truncate(typed, 100) });
    });
  });

  gladys.onSceneAction(SCENE_ACTIONS.WATCHED, async (fields = {}) => {
    requireLink();
    const typed = String(fields?.title ?? '').trim();
    const nextEpisode = fields?.type === 'next_episode';
    return guarded(async () => {
      let found;
      let body;
      let key;
      let path = 'movies';
      if (nextEpisode) {
        const shows = store.upNext().filter((show) => show.episodeId);
        const lower = typed.toLowerCase();
        const exact = shows.filter((show) => sameTitle(show.title, typed));
        const partial = shows.filter((show) => lower && show.title.toLowerCase().includes(lower));
        const [show] = exact.length ? exact : partial.length === 1 ? partial : [];
        if (!show) {
          return writeResult('no_next', 'writeNoNext', { query: truncate(typed, 100) });
        }
        found = { title: fullTitle(show), year: show.year, slug: show.slug || show.traktId };
        body = { episodes: [{ ids: { trakt: show.episodeId } }] };
        key = `episode-${show.episodeId}`;
        path = 'shows';
      } else {
        found = typed ? await findTitle('movie', typed) : null;
        if (!found) {
          return writeResult('not_found', 'writeNotFound', { query: truncate(typed, 100) });
        }
        body = { movies: [{ ids: found.ids }] };
        key = `movie-${found.ids.trakt ?? found.ids.slug}`;
      }
      const values = { title: found.title };
      if (now() - (recentWrites.get(key) ?? -Infinity) < WRITE_GUARD_MS) {
        return writeResult('already', 'writeAlready', values, found, path);
      }
      const answer = await client.addToHistory(body);
      if (!(answer?.added?.[nextEpisode ? 'episodes' : 'movies'] > 0)) {
        return writeResult('not_found', 'writeNotFound', { query: truncate(typed, 100) });
      }
      recentWrites.set(key, now());
      for (const [other, at] of recentWrites) {
        if (now() - at >= WRITE_GUARD_MS) {
          recentWrites.delete(other);
        }
      }
      readQuietly();
      return writeResult('marked', 'writeMarked', values, found, path);
    });
  });

  return {
    /** Start the one-minute tick (after connect). */
    start() {
      timer ??= setInterval(tick, TICK_MS);
      timer.unref?.();
    },
    /** Stop the timers and write the state (shutdown). */
    stop() {
      stopped = true;
      clearInterval(timer);
      timer = null;
      for (const pending of pendingWidgetRefresh.values()) {
        clearTimeout(pending);
      }
      pendingWidgetRefresh.clear();
      store.flush();
    },
    tick,
    scan,
    /** @returns {Promise<void>} Resolved when nothing runs in the background. */
    idle: async () => {
      await waiting;
      await ticking;
      await polling;
      await scanning;
    },
    store,
  };
}

export { ACTIONS, SCENE_ACTIONS, TRIGGERS, NEXT_OUTPUTS, WRITE_OUTPUTS };
