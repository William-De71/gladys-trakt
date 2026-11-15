# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.1.0] - unreleased

### Added

- Your Trakt account in Gladys, through the official Trakt API: your own free API app (its Client ID only) and a sign-in by code on trakt.tv/activate from the Connect button; the tokens are renewed on their own.
- A "Shows and movies" calendar for every user who enables the integration in "My calendars": the episodes of the shows you watch or keep in your watchlist at their airing time, the movie releases and the streaming releases of your watchlist as all-day events (30 to 90 days ahead, specials optional).
- Scene triggers: new in the calendar, release day (the day itself, the day before or a week before, at the hour you choose), an episode airs now, date changed, playback started and playback stopped (from Plex, Kodi, Jellyfin, Infuse or the Trakt apps), and account to link again; each with filters by kind and title and a ready-made sentence.
- Scene actions: the next episode or release, add a movie or a show to the watchlist, and mark a movie or the next episode of a show as watched (never twice within an hour).
- Dashboard widgets: upcoming shows and movies, shows in progress (next episode and progress) and now watching (time left, start, end), with posters cached by the integration as Trakt requires.
- Configuration buttons: read again now, and disconnect the account.
- Gentle with Trakt: about ten requests per reading every 1 to 12 hours, one a minute for "Now watching", a pause when Trakt asks to slow down.
- Cloud transport: the Trakt API and its images.
- English, French, German and Spanish everywhere: settings, calendar, widgets, scenes and documentation.

[0.1.0]: https://github.com/William-De71/gladys-trakt/releases/tag/v0.1.0
