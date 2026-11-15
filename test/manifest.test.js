// The manifest against the code: the keys it declares are the ones the code
// handles, the store limits hold, the transport and permissions are right.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

import { LEADS, NEXT_OUTPUTS, TRIGGERS, WRITE_OUTPUTS } from '../src/events.js';
import { ACTIONS, SCENE_ACTIONS } from '../src/app.js';
import { COUNTS, DEFAULT_COUNT, WIDGETS } from '../src/widgets.js';
import {
  ACCOUNT_FIELD,
  AUTO_LANGUAGE,
  DAYS_AHEAD,
  DEFAULT_DAYS_AHEAD,
  DEFAULT_INTERVAL,
  DEFAULT_NOTIFY_HOUR,
  INTERNAL_KEYS,
  INTERVALS,
  normalizeConfig,
} from '../src/config.js';
import { LANGUAGES } from '../src/i18n.js';
import { DEFAULT_KINDS, KINDS } from '../src/items.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = read('../gladys-assistant-integration.json');
const pkg = read('../package.json');
const byKey = (list) => new Map(list.map((entry) => [entry.key, entry]));
const values = (field) => field.options.map((option) => option.value);
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('a calendar integration, in lockstep with package.json, at 0.x until 1.0.0 is decided', () => {
  assert.equal(manifest.type, 'calendar');
  assert.equal(manifest.name, 'Trakt');
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/william-de71/gladys-trakt:${pkg.version}`);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/William-De71/gladys-trakt/main/cover.jpg',
  );
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.name, 'gladys-trakt');
  assert.deepEqual(Object.keys(pkg.dependencies), ['@gladysassistant/integration-sdk']);
});

test('declares the cloud transport only: the Trakt API and its images', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.doesNotMatch(source('../src/app.js'), /publishTransports|GLADYS_PREFER_LOCAL/);
  assert.match(source('../src/auth.js'), /'https:\/\/api\.trakt\.tv'/);
  assert.match(source('../src/images.js'), /trakt\\\.tv/);
});

test('requires Gladys 5.3.0 (calendar integrations, catalog keywords); no permission, no device', () => {
  assert.equal(manifest.gladys_version, '>=5.3.0');
  assert.deepEqual(manifest.categories, ['multimedia', 'leisure']);
  for (const key of [
    'location',
    'network_wake',
    'containers',
    'network_discovery',
    'webhooks',
    'account_schema',
    'music',
  ]) {
    assert.equal(manifest[key], undefined, key);
  }
  assert.doesNotMatch(source('../src/app.js'), /publishDiscoveredDevices|onSetValue|onPoll/);
});

test('declares exactly the buttons, scene triggers, actions and widgets the code handles', () => {
  assert.deepEqual(
    manifest.actions.map((action) => action.key).sort(),
    Object.values(ACTIONS).sort(),
  );
  assert.deepEqual(
    manifest.scene_triggers.map((trigger) => trigger.key).sort(),
    Object.values(TRIGGERS).sort(),
  );
  assert.deepEqual(
    manifest.scene_actions.map((action) => action.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key).sort(),
    Object.values(WIDGETS).sort(),
  );
  const app = source('../src/app.js');
  for (const key of Object.keys(WIDGETS)) {
    assert.match(app, new RegExp(`widget\\(WIDGETS\\.${key},`), key);
  }
  for (const key of Object.keys(SCENE_ACTIONS)) {
    assert.match(app, new RegExp(`onSceneAction\\(SCENE_ACTIONS\\.${key}`), key);
  }
  for (const key of Object.keys(ACTIONS)) {
    assert.match(app, new RegExp(`onAction\\(ACTIONS\\.${key}`), key);
  }
  for (const action of manifest.actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120, action.key);
  }
});

test('the configuration of the code: Client ID, Connect, kinds, days, options', () => {
  const config = byKey(manifest.config_schema);
  assert.equal(config.get('client_id').type, 'string');
  assert.equal(config.get('client_id').required, true);
  assert.equal(config.get(ACCOUNT_FIELD).type, 'account_link');
  const kinds = config.get('kinds');
  assert.equal(kinds.type, 'multi_select');
  assert.deepEqual(values(kinds), KINDS);
  assert.deepEqual(kinds.default, DEFAULT_KINDS);
  assert.deepEqual(values(config.get('days_ahead')), DAYS_AHEAD.map(String));
  assert.equal(config.get('days_ahead').default, String(DEFAULT_DAYS_AHEAD));
  assert.deepEqual(values(config.get('interval_hours')), INTERVALS.map(String));
  assert.equal(config.get('interval_hours').default, String(DEFAULT_INTERVAL));
  for (const key of ['specials', 'watching']) {
    assert.equal(config.get(key).type, 'boolean', key);
  }
  const hour = config.get('notify_hour');
  assert.deepEqual(
    [hour.type, hour.min, hour.max, hour.default],
    ['number', 0, 23, DEFAULT_NOTIFY_HOUR],
  );
  for (const key of Object.values(INTERNAL_KEYS)) {
    assert.equal(config.get(key), undefined, `${key}: internal key, never shown`);
  }
  for (const field of manifest.config_schema) {
    assert.ok(!['text', 'password'].includes(field.type), `${field.key}: ${field.type}`);
    assert.equal(field.display_if, undefined, field.key);
    if (field.placeholder) {
      assert.deepEqual(Object.keys(field.placeholder).sort(), [...LANGUAGES].sort(), field.key);
    }
  }
  // The defaults of the manifest are the defaults of the code.
  const defaults = normalizeConfig({});
  assert.deepEqual(defaults.kinds, kinds.default);
  assert.equal(String(defaults.daysAhead), config.get('days_ahead').default);
  assert.equal(String(defaults.intervalHours), config.get('interval_hours').default);
  assert.equal(defaults.notifyHour, hour.default);
  assert.equal(defaults.specials, config.get('specials').default);
  assert.equal(defaults.watching, config.get('watching').default);
  // Every key the code reads is declared.
  const code = source('../src/config.js');
  for (const [, key] of code.matchAll(/\braw\.([a-z_]+)\b(?!\()/g)) {
    assert.ok(config.has(key), `raw.${key} is a field of the config_schema`);
  }
});

test('every filter is a key of its event; the options are the keys of the code', () => {
  for (const trigger of manifest.scene_triggers) {
    const fields = byKey(trigger.fields ?? []);
    for (const key of fields.keys()) {
      assert.ok(
        byKey(trigger.variables).has(key),
        `${trigger.key}: the filter ${key} is a key of the event`,
      );
    }
    const kind = fields.get('kind');
    if (kind && !trigger.key.startsWith('watching')) {
      assert.deepEqual(values(kind), KINDS, trigger.key);
    }
    assert.ok(trigger.variables.length <= 20, trigger.key);
  }
  const lead = byKey(byKey(manifest.scene_triggers).get(TRIGGERS.DAY).fields).get('lead');
  assert.deepEqual(values(lead), LEADS);
  assert.deepEqual([lead.required, lead.default], [true, '0'], 'one event per item by default');
  const actions = byKey(manifest.scene_actions);
  assert.deepEqual(
    actions
      .get(SCENE_ACTIONS.NEXT)
      .outputs.map((output) => output.key)
      .sort(),
    [...NEXT_OUTPUTS].sort(),
  );
  for (const key of [SCENE_ACTIONS.WATCHLIST, SCENE_ACTIONS.WATCHED]) {
    assert.deepEqual(
      actions
        .get(key)
        .outputs.map((output) => output.key)
        .sort(),
      [...WRITE_OUTPUTS].sort(),
    );
  }
  const widgets = byKey(manifest.widgets);
  for (const key of [WIDGETS.UPCOMING, WIDGETS.UP_NEXT]) {
    const count = byKey(widgets.get(key).settings).get('count');
    assert.deepEqual(values(count), COUNTS.map(String), key);
    assert.equal(count.default, String(DEFAULT_COUNT), key);
  }
  assert.deepEqual(values(byKey(widgets.get(WIDGETS.UPCOMING).settings).get('kinds')), KINDS);
});

test('limits of the store: counts, timeouts, sizes, no secret in widget settings', () => {
  assert.ok(manifest.widgets.length >= 1 && manifest.widgets.length <= 5);
  assert.ok(manifest.actions.length <= 10);
  assert.ok(manifest.scene_triggers.length <= 20);
  assert.ok(manifest.scene_actions.length <= 20);
  for (const trigger of manifest.scene_triggers) {
    assert.ok((trigger.fields ?? []).length <= 10 && trigger.variables.length <= 20, trigger.key);
  }
  for (const action of manifest.scene_actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120, action.key);
    assert.ok(
      (action.fields ?? []).length <= 10 && (action.outputs ?? []).length <= 20,
      action.key,
    );
  }
  for (const widget of manifest.widgets) {
    assert.ok((widget.settings ?? []).length <= 10);
    for (const setting of widget.settings ?? []) {
      assert.ok(!['secret', 'oauth2', 'account_link'].includes(setting.type));
    }
  }
  const size = statSync(new URL('../gladys-assistant-integration.json', import.meta.url)).size;
  assert.ok(size < 100 * 1024, `${size} bytes`);
  const cover = readFileSync(new URL('../cover.jpg', import.meta.url));
  assert.ok(cover.length < 150 * 1024, `cover.jpg: ${cover.length} bytes`);
  assert.equal(cover.readUInt16BE(0), 0xffd8, 'cover.jpg is a JPEG');
});

test('offers the languages of the code, automatic by default', () => {
  const field = byKey(manifest.config_schema).get('language');
  assert.deepEqual(values(field), [AUTO_LANGUAGE, ...LANGUAGES]);
  assert.equal(field.default, AUTO_LANGUAGE);
});

test('catalog fields of Gladys 5.3: search keywords, available worldwide', () => {
  assert.ok(Array.isArray(manifest.keywords), 'keywords');
  assert.ok(manifest.keywords.length >= 1 && manifest.keywords.length <= 10, '1 to 10 keywords');
  for (const keyword of manifest.keywords) {
    assert.ok(keyword.length <= 30 && keyword.trim().length >= 2, keyword);
  }
  const normalized = manifest.keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(normalized).size, normalized.length, 'unique once trimmed and lowercased');
  assert.ok(!normalized.includes(manifest.name.toLowerCase()), 'the name is already searched');
  // No `countries`: usable anywhere, the catalog shows it in every country.
  assert.equal(manifest.countries, undefined);
});
