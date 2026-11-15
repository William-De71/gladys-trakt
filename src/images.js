// -----------------------------------------------------------------------------
// The posters of the widgets.
//
// Trakt forbids loading its images straight from its servers ("hotlinking"):
// every image must be cached by the application. The integration downloads a
// poster once, keeps it in /data/posters/ and serves it to Gladys from there
// (onWidgetGetImage): the browser never sees a Trakt address.
//
// A widget refers to a poster by a key, `tk-<16 hex of the SHA-256 of its
// address>`: a new poster of the same show has another key, so Gladys (which
// caches an image one hour per key) shows it at once. /data keeps key ->
// address, so the key still works after a restart.
//
// A widget only shows a poster known to be cached: after each reading the
// integration downloads the posters of what the widgets can show (30 at most
// per reading, one at a time). A poster no item used for 30 days is deleted.
//
// Checked before it goes out: an https address of trakt.tv, a JPEG, PNG or
// WebP by its magic number, 300 KB at most (the limit of Gladys).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { DAY_MS } from './time.js';

const MAX_BYTES = 300 * 1024;
const MEMORY_SIZE = 40;
const TIMEOUT_MS = 20 * 1000;
const KEY_REGEX = /^tk-[0-9a-f]{16}$/;
const HOST_REGEX = /(^|\.)trakt\.tv$/;
const MAX_DOWNLOADS = 30;
const DOWNLOAD_SPACING_MS = 300;
const FAILED_RETRY_MS = DAY_MS;
const UNUSED_MS = 30 * DAY_MS;

/**
 * @description Whether an address is a Trakt image the integration may fetch.
 * @param {unknown} url - The address.
 * @returns {boolean} True for https on trakt.tv or one of its subdomains.
 */
function isTraktImage(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === 'https:' && HOST_REGEX.test(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * @description The widget image key of a poster address.
 * @param {string} url - The address.
 * @returns {string} `tk-<16 hex>`.
 */
const imageKeyOf = (url) => `tk-${createHash('sha256').update(url).digest('hex').slice(0, 16)}`;

/**
 * @description Whether some bytes are a JPEG, PNG or WebP image.
 * @param {Buffer} bytes - The bytes.
 * @returns {boolean} True for one of the three.
 */
function isImage(bytes) {
  if (bytes.length < 12) {
    return false;
  }
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp =
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP';
  return jpeg || png || webp;
}

/**
 * @description Create the poster provider.
 * @param {object} options - `{ store, dir, fetch, userAgent, now, sleep, logger }`.
 * @returns {{ get: Function, keyIfReady: Function, cache: Function }} The provider.
 */
function createImages({
  store,
  dir = join(dirname(store.path ?? '/data/state.json'), 'posters'),
  fetch = globalThis.fetch,
  userAgent = 'gladys-trakt',
  now = () => Date.now(),
  sleep = defaultSleep,
  logger,
}) {
  const memory = new Map();
  const posters = () => store.data.posters;
  const fileOf = (key) => join(dir, key);

  const remember = (key, value) => {
    memory.delete(key);
    memory.set(key, value);
    if (memory.size > MEMORY_SIZE) {
      memory.delete(memory.keys().next().value);
    }
  };

  const download = async (url) => {
    const response = await fetch(url, {
      headers: { 'user-agent': userAgent },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    if (response.url && !isTraktImage(response.url)) {
      throw new Error('unexpected host');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_BYTES || !isImage(bytes)) {
      throw new Error(`not a usable image (${bytes.length} bytes)`);
    }
    return bytes;
  };

  /** Download a poster to /data and remember the outcome. */
  const fetchToDisk = async (key) => {
    const entry = posters()[key];
    try {
      const bytes = await download(entry.url);
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${fileOf(key)}.tmp`, bytes);
      renameSync(`${fileOf(key)}.tmp`, fileOf(key));
      remember(key, bytes.toString('base64'));
      entry.ok = true;
    } catch (error) {
      logger?.debug?.(`poster ${key}: ${error.message}`);
      entry.ok = false;
    }
    entry.at = now();
    store.changed();
    return entry.ok;
  };

  return {
    /**
     * @param {string} key - A widget image key.
     * @returns {Promise<string>} The raw base64 of the image.
     */
    async get(key) {
      if (!KEY_REGEX.test(String(key ?? '')) || !posters()[key]) {
        throw new Error(`unknown image ${key}`);
      }
      if (memory.has(key)) {
        const value = memory.get(key);
        remember(key, value);
        return value;
      }
      try {
        const bytes = readFileSync(fileOf(key));
        if (bytes.length <= MAX_BYTES && isImage(bytes)) {
          remember(key, bytes.toString('base64'));
          return memory.get(key);
        }
      } catch {
        // Not on disk (a /data emptied by hand): downloaded again below.
      }
      if (!(await fetchToDisk(key))) {
        throw new Error(`image ${key}: not available`);
      }
      return memory.get(key);
    },
    /**
     * @description The key of a poster a widget may show now.
     * @param {string} url - The poster address ('' when the item has none).
     * @returns {string|null} The key, null while the poster is not cached.
     */
    keyIfReady(url) {
      if (!url) {
        return null;
      }
      const key = imageKeyOf(url);
      return posters()[key]?.ok === true ? key : null;
    },
    /**
     * @description Cache the posters of what the widgets can show, and forget
     * the ones no longer used.
     * @param {string[]} urls - Poster addresses, the most useful first.
     * @returns {Promise<boolean>} Whether a poster became available.
     */
    async cache(urls) {
      let changed = false;
      let downloads = 0;
      const wanted = [...new Set(urls.filter(isTraktImage))];
      for (const url of wanted) {
        const key = imageKeyOf(url);
        const entry = (posters()[key] ??= { url, ok: null, at: 0, used: 0 });
        entry.used = now();
        if (entry.ok === true || (entry.ok === false && now() - entry.at < FAILED_RETRY_MS)) {
          continue;
        }
        if (downloads >= MAX_DOWNLOADS) {
          continue;
        }
        if (downloads > 0) {
          await sleep(DOWNLOAD_SPACING_MS);
        }
        downloads += 1;
        changed = (await fetchToDisk(key)) || changed;
      }
      for (const [key, entry] of Object.entries(posters())) {
        if (now() - (entry.used ?? 0) > UNUSED_MS) {
          delete posters()[key];
          memory.delete(key);
        }
      }
      try {
        for (const name of readdirSync(dir)) {
          if (!posters()[name]) {
            unlinkSync(join(dir, name));
          }
        }
      } catch {
        // No folder yet.
      }
      store.changed();
      return changed;
    },
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

export { MAX_BYTES, MAX_DOWNLOADS, imageKeyOf, isTraktImage, isImage, createImages };
