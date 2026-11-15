// -----------------------------------------------------------------------------
// Trakt sign-in: the device code flow of the official API
// (https://developer.trakt.tv/docs/authentication-oauth), with the Client ID
// alone — Trakt gives no Client Secret to new apps and deprecates it.
//
//   1. "Connect" (account_link field): POST /oauth/device/code with the Client
//      ID -> a user code and the Trakt page where to type it.
//   2. The user signs in on that page and types the code. Nothing comes back
//      to Gladys: the integration asks POST /oauth/device/token every
//      `interval` seconds. Trakt answers with HTTP statuses, not with OAuth
//      error names: 400 pending, 404 unknown code, 409 already used, 410
//      expired, 418 denied, 429 slow down.
//   3. The answer holds an access token (7 days) and a refresh token.
//      POST /oauth/token (grant refresh_token) gives a new pair: **refresh
//      tokens are single-use**, the one sent dies at once. So one refresh at a
//      time (single-flight), and the new pair is stored before it is used.
//      A dead refresh token is a 400 `invalid_grant`: only a new Connect helps.
// -----------------------------------------------------------------------------

const API_URL = 'https://api.trakt.tv';
// The redirect URI of the apps without a web page; the device flow never
// redirects, but the refresh request requires the field.
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';
const REQUEST_TIMEOUT_MS = 30000;
// Refresh a day before the expiry: a reading every few hours always finds a
// token with some life left.
const EXPIRY_MARGIN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIFETIME_S = 7 * 24 * 60 * 60;
const MAX_WAIT_MS = 15 * 60 * 1000;

/** An error of the Trakt sign-in; `reauth` when only a new Connect can fix it. */
class AuthError extends Error {
  /**
   * @param {string} message - The message.
   * @param {object} [details] - `{ status, code, reauth }`.
   */
  constructor(message, { status = 0, code = '', reauth = false } = {}) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
    this.reauth = reauth;
  }
}

/**
 * @description The headers Trakt requires on every call.
 * @param {string} clientId - The Client ID.
 * @param {string} userAgent - The User-Agent of the integration.
 * @returns {object} The headers.
 */
function baseHeaders(clientId, userAgent) {
  return {
    'Content-Type': 'application/json',
    'User-Agent': userAgent,
    'trakt-api-key': clientId,
    'trakt-api-version': '2',
  };
}

/**
 * @description POST some JSON to Trakt and read the JSON answer.
 * @param {object} options - `{ fetchImpl, path, body, clientId, userAgent }`.
 * @returns {Promise<{ status: number, body: object }>} The answer ({} when not JSON).
 * @throws {AuthError} When Trakt cannot be reached.
 */
async function postJson({ fetchImpl, path, body, clientId, userAgent }) {
  let response;
  try {
    response = await fetchImpl(`${API_URL}${path}`, {
      method: 'POST',
      headers: baseHeaders(clientId, userAgent),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new AuthError(`Trakt unreachable: ${err.message}`);
  }
  let answer;
  try {
    answer = (await response.json()) ?? {};
  } catch {
    answer = {};
  }
  return { status: response.status, body: answer && typeof answer === 'object' ? answer : {} };
}

/**
 * @description The error of a refused answer (never a token).
 * @param {number} status - The HTTP status.
 * @param {object} body - The body.
 * @returns {string} The description.
 */
function describe(status, body) {
  const code = typeof body?.error === 'string' ? body.error : '';
  const detail = typeof body?.error_description === 'string' ? body.error_description : '';
  return `HTTP ${status}${code ? `, ${code}` : ''}${detail ? `: ${detail.slice(0, 200)}` : ''}`;
}

/**
 * @description Read a token answer into the stored shape.
 * @param {object} body - The JSON body.
 * @param {number} now - Now, in ms.
 * @returns {{ accessToken: string, refreshToken: string, expiresAt: number }} The tokens.
 * @throws {AuthError} Without access or refresh token.
 */
function readTokens(body, now) {
  const read = (value) => (typeof value === 'string' && value ? value : '');
  const accessToken = read(body?.access_token);
  const refreshToken = read(body?.refresh_token);
  if (!accessToken || !refreshToken) {
    throw new AuthError('Trakt sent no token');
  }
  const expiresIn = Number(body.expires_in);
  const lifetime = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : DEFAULT_LIFETIME_S;
  return { accessToken, refreshToken, expiresAt: now + lifetime * 1000 };
}

/**
 * @description Ask Trakt for a device code.
 * @param {object} options - `{ clientId, fetchImpl, userAgent }`.
 * @returns {Promise<object>} `{ deviceCode, userCode, verificationUrl, interval, expiresIn }`.
 * @throws {AuthError} When Trakt refuses (unknown Client ID…).
 */
async function requestDeviceCode({ clientId, fetchImpl = fetch, userAgent }) {
  const { status, body } = await postJson({
    fetchImpl,
    path: '/oauth/device/code',
    body: { client_id: clientId },
    clientId,
    userAgent,
  });
  if (
    status !== 200 ||
    typeof body.device_code !== 'string' ||
    typeof body.user_code !== 'string'
  ) {
    throw new AuthError(`Trakt refused the code request (${describe(status, body)})`, {
      status,
      code: status === 401 || status === 403 ? 'invalid_client' : (body.error ?? ''),
    });
  }
  const url = typeof body.verification_url === 'string' ? body.verification_url : '';
  if (!/^https:\/\/([a-z0-9-]+\.)*trakt\.tv(\/|$)/.test(url)) {
    throw new AuthError('Trakt sent no activation page');
  }
  const interval = Number(body.interval);
  const expiresIn = Number(body.expires_in);
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUrl: url,
    interval: Number.isFinite(interval) && interval > 0 ? Math.min(interval, 60) : 5,
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 600,
  };
}

/**
 * @description Wait for the approval of a device code.
 * @param {object} options - `{ clientId, code, fetchImpl, userAgent, sleep, now, cancelled }`.
 * @returns {Promise<object|null>} The tokens, null when cancelled.
 * @throws {AuthError} When denied (`code: 'denied'`), expired (`'expired'`) or refused.
 */
async function waitForApproval({
  clientId,
  code,
  fetchImpl = fetch,
  userAgent,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  cancelled = () => false,
}) {
  const deadline = now() + Math.min(code.expiresIn * 1000, MAX_WAIT_MS);
  let interval = code.interval * 1000;
  let serverErrors = 0;
  while (now() < deadline) {
    await sleep(interval);
    if (cancelled()) {
      return null;
    }
    let answer;
    try {
      answer = await postJson({
        fetchImpl,
        path: '/oauth/device/token',
        body: { code: code.deviceCode, client_id: clientId },
        clientId,
        userAgent,
      });
    } catch {
      continue; // network hiccup: keep waiting
    }
    if (cancelled()) {
      return null;
    }
    const { status, body } = answer;
    if (status === 200) {
      return readTokens(body, now());
    }
    if (status === 400) {
      serverErrors = 0;
      continue; // pending
    }
    if (status === 429) {
      interval += 1000;
      continue;
    }
    if (status === 418) {
      throw new AuthError('The code was denied on Trakt', { status, code: 'denied' });
    }
    if (status === 410) {
      break;
    }
    if (status >= 500 && serverErrors < 5) {
      serverErrors += 1;
      continue;
    }
    throw new AuthError(`Trakt refused the sign-in (${describe(status, body)})`, {
      status,
      code: status === 409 ? 'used' : 'refused',
    });
  }
  throw new AuthError('The code was not typed in time', { code: 'expired' });
}

/**
 * @description Create the token manager.
 * @param {object} options - Options.
 * @param {Function} options.getClientId - `() => string`.
 * @param {Function} options.saveTokens - `async (tokens) => void`, stores them.
 * @param {Function} [options.fetchImpl] - fetch.
 * @param {Function} [options.now] - Clock.
 * @param {string} [options.userAgent] - User-Agent.
 * @returns {object} The manager.
 */
function createTokenManager({
  getClientId,
  saveTokens,
  fetchImpl = fetch,
  now = Date.now,
  userAgent,
}) {
  const empty = () => ({ accessToken: '', refreshToken: '', expiresAt: 0 });
  let current = empty();
  let refreshing = null;

  /**
   * @description Store and adopt new tokens (stored first: the previous
   * refresh token is already dead).
   * @param {object} tokens - The tokens.
   * @returns {Promise<object>} The tokens.
   */
  async function adopt(tokens) {
    current = { ...tokens };
    await saveTokens(current);
    return current;
  }

  /**
   * @description Run one refresh, shared by every caller.
   * @returns {Promise<object>} The new tokens.
   */
  function refresh() {
    if (!refreshing) {
      const previous = current;
      refreshing = (async () => {
        const clientId = getClientId();
        if (!clientId || !previous.refreshToken) {
          throw new AuthError('Not signed in to Trakt', { reauth: true });
        }
        const { status, body } = await postJson({
          fetchImpl,
          path: '/oauth/token',
          body: {
            refresh_token: previous.refreshToken,
            client_id: clientId,
            redirect_uri: REDIRECT_URI,
            grant_type: 'refresh_token',
          },
          clientId,
          userAgent,
        });
        if (status !== 200) {
          throw new AuthError(`Trakt refused the token refresh (${describe(status, body)})`, {
            status,
            code: body.error ?? '',
            // 400 invalid_grant, 401: the refresh token is dead. 403 is the
            // Client ID (deleted app); 429 and 5xx are worth another try.
            reauth: status === 400 || status === 401 || status === 403,
          });
        }
        return adopt(readTokens(body, now()));
      })().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  return {
    /**
     * @description Load the stored tokens (startup, config reload).
     * @param {object} tokens - The stored tokens.
     */
    setTokens(tokens) {
      if (!refreshing) {
        current = { ...empty(), ...tokens };
      }
    },
    /** @returns {boolean} True when signed in (a refresh token is known). */
    hasGrant: () => Boolean(current.refreshToken),
    /** @returns {number} When the access token expires, in ms. */
    expiresAt: () => current.expiresAt,
    adopt,
    /**
     * @description Forget the tokens (disconnect, dead refresh token).
     * @returns {Promise<void>}
     */
    async clear() {
      current = empty();
      await saveTokens(current);
    },
    /** @returns {boolean} True near the expiry. */
    dueForRefresh: () =>
      Boolean(current.refreshToken) && current.expiresAt - EXPIRY_MARGIN_MS <= now(),
    refresh,
    /**
     * @description A valid access token, refreshed when needed.
     * @param {object} [options] - `{ rejected }`: a token an API call refused.
     * @returns {Promise<string>} The access token.
     * @throws {AuthError} With `reauth` when a new sign-in is needed.
     */
    async getAccessToken({ rejected = null } = {}) {
      const stale = rejected !== null && rejected === current.accessToken;
      if (!stale && current.accessToken && current.expiresAt - 60000 > now()) {
        return current.accessToken;
      }
      const tokens = await refresh();
      return tokens.accessToken;
    },
  };
}

export {
  API_URL,
  REDIRECT_URI,
  EXPIRY_MARGIN_MS,
  AuthError,
  baseHeaders,
  readTokens,
  requestDeviceCode,
  waitForApproval,
  createTokenManager,
};
