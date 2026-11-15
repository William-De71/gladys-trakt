// -----------------------------------------------------------------------------
// Configuration of the integration.
//
// Fields of the config_schema:
//   - `client_id`       the Client ID of the Trakt API app the user created
//                       (trakt.tv, "My Apps"): it identifies the application,
//                       it is not a password;
//   - `trakt_account`   the Connect button (account_link field): the device
//                       code flow of src/auth.js;
//   - `kinds`           what the calendar, the widgets and the scenes see:
//                       episodes, movie releases, streaming releases;
//   - `days_ahead`      how far the calendar is read;
//   - `specials`        keep the specials (season 0);
//   - `watching`        ask Trakt every minute what is being watched;
//   - `interval_hours`  hours between two readings of the calendar;
//   - `notify_hour`     local hour of the "release day" trigger;
//   - `language`        language of the texts Gladys does not ask for in a
//                       language (scene data, action outputs): `auto` follows
//                       the last widget request.
//
// Internal keys, outside the config_schema (never shown in the UI): the tokens
// of the sign-in and the language of the last widget
// request. They live in the Gladys configuration, which is backed up, so a
// restored instance stays signed in.
// -----------------------------------------------------------------------------

import { isLanguage } from './i18n.js';
import { DEFAULT_KINDS, KINDS } from './items.js';

const AUTO_LANGUAGE = 'auto';
const ACCOUNT_FIELD = 'trakt_account';
const INTERNAL_KEYS = {
  accessToken: 'access_token',
  refreshToken: 'refresh_token',
  expiresAt: 'token_expires_at',
  language: 'last_language',
};
const DAYS_AHEAD = [30, 60, 90];
const DEFAULT_DAYS_AHEAD = 60;
const INTERVALS = [1, 3, 6, 12];
const DEFAULT_INTERVAL = 3;
const DEFAULT_NOTIFY_HOUR = 9;

/**
 * @description Read a list of keys.
 * @param {unknown} raw - An array (multi_select), a JSON array or "a, b".
 * @param {string[]} allowed - The known keys.
 * @param {string[]} fallback - The default when none is valid.
 * @returns {string[]} Known keys, in the order of `allowed`.
 * @example
 * readKeys(['movie', 'nope', 'episode'], ['episode', 'movie'], ['episode']); // -> ['episode', 'movie']
 */
function readKeys(raw, allowed, fallback) {
  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      list = raw.split(/[,;\s]+/);
    }
  }
  const given = new Set((Array.isArray(list) ? list : []).map((value) => String(value).trim()));
  const keys = allowed.filter((key) => given.has(key));
  return keys.length ? keys : [...fallback];
}

const readText = (raw, max = 200) => (typeof raw === 'string' ? raw.trim().slice(0, max) : '');

const readChoice = (raw, allowed, fallback) =>
  raw !== '' && raw !== null && allowed.includes(Number(raw)) ? Number(raw) : fallback;

/**
 * @description Read a checkbox.
 * @param {unknown} raw - A boolean, "true" / "false", or nothing.
 * @param {boolean} fallback - The default.
 * @returns {boolean} The value.
 */
function readBoolean(raw, fallback) {
  if (typeof raw === 'boolean') {
    return raw;
  }
  if (raw === 'true' || raw === 'false') {
    return raw === 'true';
  }
  return fallback;
}

/**
 * @description Normalize the raw config object from the host API.
 * @param {object} [rawConfig] - The raw config values.
 * @returns {object} The normalized configuration.
 */
function normalizeConfig(rawConfig = {}) {
  const raw = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const hour = Number(raw.notify_hour);
  const expiresAt = Number(raw[INTERNAL_KEYS.expiresAt]);
  return {
    // A Client ID has no space; anything else is the user's mistake to see in the status.
    clientId: readText(raw.client_id).replace(/\s+/g, ''),
    kinds: readKeys(raw.kinds, KINDS, DEFAULT_KINDS),
    daysAhead: readChoice(raw.days_ahead, DAYS_AHEAD, DEFAULT_DAYS_AHEAD),
    specials: readBoolean(raw.specials, false),
    watching: readBoolean(raw.watching, true),
    intervalHours: readChoice(raw.interval_hours, INTERVALS, DEFAULT_INTERVAL),
    notifyHour:
      raw.notify_hour !== '' &&
      raw.notify_hour !== null &&
      Number.isInteger(hour) &&
      hour >= 0 &&
      hour <= 23
        ? hour
        : DEFAULT_NOTIFY_HOUR,
    language: isLanguage(raw.language) ? raw.language : AUTO_LANGUAGE,
    lastLanguage: isLanguage(raw[INTERNAL_KEYS.language]) ? raw[INTERNAL_KEYS.language] : 'en',
    tokens: {
      accessToken: readText(raw[INTERNAL_KEYS.accessToken], 4000),
      refreshToken: readText(raw[INTERNAL_KEYS.refreshToken], 4000),
      expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : 0,
    },
  };
}

/**
 * @description The language of the texts no Gladys request gives one for.
 * @param {object} config - Normalized config.
 * @returns {string} en, fr, de or es.
 */
function textLanguage(config) {
  return config.language === AUTO_LANGUAGE ? config.lastLanguage : config.language;
}

export {
  AUTO_LANGUAGE,
  ACCOUNT_FIELD,
  INTERNAL_KEYS,
  DAYS_AHEAD,
  DEFAULT_DAYS_AHEAD,
  INTERVALS,
  DEFAULT_INTERVAL,
  DEFAULT_NOTIFY_HOUR,
  readKeys,
  readBoolean,
  normalizeConfig,
  textLanguage,
};
