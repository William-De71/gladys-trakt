// -----------------------------------------------------------------------------
// HTTP client of the Trakt API (https://developer.trakt.tv, version 2).
//
// Every call carries the required headers (Content-Type, User-Agent,
// trakt-api-key, trakt-api-version) and the access token of the account.
// One request at a time: GET calls 250 ms apart, writes 1.1 s apart (Trakt
// allows one POST per second and 500 GET per 5 minutes for a user).
//
// What Trakt answers, and what the client makes of it (`TraktError.kind`):
//   401  the access token is refused: one refresh, one retry, then `auth`;
//   403  invalid Client ID or unapproved app: `forbidden`;
//   404  `not_found`;   420  account limit (watchlist full): `limit`;
//   423  locked account: `locked`;   426  VIP only: `vip`;
//   429  `rate`: every call waits until Retry-After (a minute without it);
//   5xx, 52x (Cloudflare)  `server`;   no answer  `network`.
// A body that is not JSON (a Cloudflare page) is never parsed nor logged.
// -----------------------------------------------------------------------------

import { API_URL, AuthError, baseHeaders } from './auth.js';

const REQUEST_TIMEOUT_MS = 30000;
const GET_SPACING_MS = 250;
const WRITE_SPACING_MS = 1100;
const DEFAULT_PAUSE_MS = 60 * 1000;
const MAX_PAUSE_MS = 30 * 60 * 1000;

const CALENDAR_PATHS = { episode: 'shows', movie: 'movies', streaming: 'streaming' };

/** An error of the Trakt API. */
class TraktError extends Error {
  /**
   * @param {string} message - The message.
   * @param {object} [details] - `{ kind, status }`.
   */
  constructor(message, { kind = 'unknown', status = 0 } = {}) {
    super(message);
    this.name = 'TraktError';
    this.kind = kind;
    this.status = status;
  }
}

const KIND_BY_STATUS = {
  401: 'auth',
  403: 'forbidden',
  404: 'not_found',
  420: 'limit',
  423: 'locked',
  426: 'vip',
  429: 'rate',
};

/**
 * @description Create the client.
 * @param {object} options - Options.
 * @param {object} options.tokens - The token manager of src/auth.js.
 * @param {Function} options.getClientId - `() => string`.
 * @param {Function} [options.fetchImpl] - fetch.
 * @param {string} [options.userAgent] - User-Agent.
 * @param {Function} [options.now] - Clock.
 * @param {Function} [options.sleep] - `(ms) => Promise`.
 * @returns {object} The client.
 */
function createTraktClient({
  tokens,
  getClientId,
  fetchImpl = fetch,
  userAgent = 'gladys-trakt',
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.()),
}) {
  let queue = Promise.resolve();
  let lastCall = 0;
  let lastSpacing = 0;
  let pausedUntil = 0;

  const send = async (method, path, body, token) => {
    let response;
    try {
      response = await fetchImpl(`${API_URL}${path}`, {
        method,
        headers: { ...baseHeaders(getClientId(), userAgent), Authorization: `Bearer ${token}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new TraktError(`Trakt unreachable: ${err.message}`, { kind: 'network' });
    }
    return response;
  };

  const once = async (method, path, body) => {
    if (pausedUntil > now()) {
      throw new TraktError('Trakt asked to slow down', { kind: 'rate', status: 429 });
    }
    let token;
    let response;
    try {
      token = await tokens.getAccessToken();
      response = await send(method, path, body, token);
      if (response.status === 401) {
        token = await tokens.getAccessToken({ rejected: token });
        response = await send(method, path, body, token);
      }
    } catch (err) {
      if (err instanceof AuthError) {
        throw new TraktError(err.message, {
          kind: err.reauth ? 'auth' : 'network',
          status: err.status,
        });
      }
      throw err;
    }
    const { status } = response;
    if (status === 204) {
      return null;
    }
    if (status === 429) {
      const retry = Number(response.headers?.get?.('retry-after'));
      pausedUntil =
        now() +
        Math.min(
          Number.isFinite(retry) && retry > 0 ? retry * 1000 : DEFAULT_PAUSE_MS,
          MAX_PAUSE_MS,
        );
    }
    if (status < 200 || status >= 300) {
      throw new TraktError(`Trakt answered HTTP ${status} to ${method} ${path.split('?')[0]}`, {
        kind: KIND_BY_STATUS[status] ?? (status >= 500 ? 'server' : 'refused'),
        status,
      });
    }
    try {
      return await response.json();
    } catch {
      throw new TraktError(`Trakt sent an unreadable answer to ${method} ${path.split('?')[0]}`, {
        kind: 'server',
        status,
      });
    }
  };

  /**
   * @description Run one call after the previous ones, spaced.
   * @param {string} method - GET or POST.
   * @param {string} path - Path and query.
   * @param {object} [body] - JSON body.
   * @returns {Promise<unknown>} The JSON answer, null for a 204.
   */
  const request = (method, path, body) => {
    const run = async () => {
      const spacing = method === 'GET' ? GET_SPACING_MS : WRITE_SPACING_MS;
      const wait = lastCall + Math.max(spacing, lastSpacing) - now();
      if (wait > 0) {
        await sleep(wait);
      }
      try {
        return await once(method, path, body);
      } finally {
        lastCall = now();
        lastSpacing = spacing;
      }
    };
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  };

  const encode = encodeURIComponent;

  return {
    /** @returns {number} Until when Trakt asked to wait, in ms (0: no pause). */
    get pausedUntil() {
      return pausedUntil > now() ? pausedUntil : 0;
    },
    /**
     * @param {string} kind - `episode`, `movie` or `streaming`.
     * @param {string} start - First UTC day, `YYYY-MM-DD`.
     * @param {number} days - Days read (33 at most).
     * @returns {Promise<object[]>} The calendar of the account.
     */
    calendar: (kind, start, days) =>
      request('GET', `/calendars/my/${CALENDAR_PATHS[kind]}/${start}/${days}?extended=full`),
    /**
     * @param {number} limit - Shows asked.
     * @returns {Promise<object[]>} The shows in progress with their next episode.
     */
    upNext: (limit) => request('GET', `/sync/progress/up_next?extended=full&page=1&limit=${limit}`),
    /** @returns {Promise<object|null>} What the account is watching, null when nothing. */
    watching: () => request('GET', '/users/me/watching?extended=full'),
    /** @returns {Promise<object>} The settings of the account (user name, VIP, limits). */
    settings: () => request('GET', '/users/settings'),
    /**
     * @param {string} type - `movie` or `show`.
     * @param {string} query - A title.
     * @returns {Promise<object[]>} The best answers.
     */
    search: (type, query) =>
      request('GET', `/search/${type}?query=${encode(query)}&fields=title&limit=10`),
    /**
     * @param {string} imdb - An IMDb identifier ("tt…").
     * @param {string} type - `movie` or `show`.
     * @returns {Promise<object[]>} The matching titles.
     */
    lookup: (imdb, type) => request('GET', `/search/imdb/${encode(imdb)}?type=${type}`),
    /**
     * @param {object} body - `{ movies: [{ ids }] }` or `{ shows: [{ ids }] }`.
     * @returns {Promise<object>} `{ added, existing, not_found }`.
     */
    addToWatchlist: (body) => request('POST', '/sync/watchlist', body),
    /**
     * @param {object} body - `{ movies: [{ ids }] }` or `{ episodes: [{ ids }] }`.
     * @returns {Promise<object>} `{ added, not_found }`.
     */
    addToHistory: (body) => request('POST', '/sync/history', body),
  };
}

export { CALENDAR_PATHS, TraktError, createTraktClient };
