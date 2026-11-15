// -----------------------------------------------------------------------------
// Entry point of the Trakt external integration.
//
// Brings the Trakt account of the household into Gladys (official API, the
// user's own free API app, device code sign-in):
//   - calendar: "Shows and movies", for every user who enabled the integration
//     in "My calendars" (src/calendar.js);
//   - scene triggers: new in the calendar, release day, an episode airs now,
//     date changed, playback started / stopped, account to link again;
//   - scene actions: the next episode or release, add to the watchlist, mark
//     as watched;
//   - dashboard widgets: upcoming, shows in progress, now watching;
//   - configuration: Connect (account_link), read again, disconnect.
//
// This file only wires the SDK client: the handlers are in src/app.js.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR, TZ
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
// Trakt asks every application for a User-Agent naming the app and its version.
const app = createApp(gladys, {
  userAgent: `gladys-trakt/${version} (+https://github.com/William-De71/gladys-trakt)`,
});

gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  app.stop();
});

// --- Startup -----------------------------------------------------------------------
logger.info(`Starting the Trakt integration ${version}...`);
gladys
  .connect()
  .then(() => app.start())
  .catch((err) => {
    logger.error('Initial connection failed', err);
    process.exit(1);
  });
