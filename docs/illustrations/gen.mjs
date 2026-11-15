// Builds the widget contents of the illustrations with the integration's own
// code: node gen.mjs <repo> <out.json> (run by render.sh)
//
// Friday 20 November 2026, 20:40 in Paris: calendar answers shaped like the
// Trakt API, read through the real parsers (src/items.js, src/watching.js)
// and the real widget builders (src/widgets.js). The posters are drawn here,
// never the real artwork.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { buildUpcomingWidget, buildUpNextWidget, buildWatchingWidget } =
  await load('src/widgets.js');
const { toEpisodeItems, toMovieItems } = await load('src/items.js');
const { toUpNext } = await load('src/scan.js');
const { toWatching } = await load('src/watching.js');
const { imageKeyOf } = await load('src/images.js');
const { normalizeConfig } = await load('src/config.js');
const { LANGUAGES } = await load('src/i18n.js');
const manifest = JSON.parse(readFileSync(`${repo}/gladys-assistant-integration.json`, 'utf8'));

const NOW = Date.parse('2026-11-20T19:40:00Z');
const TZ = 'Europe/Paris';
const TODAY = '2026-11-20';

let next = 1;
const show = (title, year, network, runtime) => {
  const id = (next += 1);
  return {
    title,
    year,
    network,
    runtime,
    ids: { trakt: id, slug: title.toLowerCase().replace(/\W+/g, '-') },
    images: { poster: [`walter-r2.trakt.tv/images/shows/${id}/posters/thumb/p.jpg.webp`] },
  };
};
const severance = show('Severance', 2022, 'Apple TV+', 50);
const andor = show('Andor', 2022, 'Disney+', 45);
const slowHorses = show('Slow Horses', 2022, 'Apple TV+', 45);
const theBear = show('The Bear', 2022, 'FX', 30);
const shogun = show('Shōgun', 2024, 'FX', 60);
const episode = (s, season, number, at, extra = {}) => ({
  first_aired: at,
  episode: { season, number, title: `Episode ${number}`, ids: { trakt: next++ }, ...extra },
  show: s,
});
const movie = (title, released) => {
  const id = (next += 1);
  return {
    released,
    movie: {
      title,
      year: Number(released.slice(0, 4)),
      ids: { trakt: id, slug: title.toLowerCase().replace(/\W+/g, '-') },
      runtime: 150,
      images: { poster: [`walter-r2.trakt.tv/images/movies/${id}/posters/thumb/p.jpg.webp`] },
    },
  };
};

const items = [
  ...toEpisodeItems([
    episode(slowHorses, 6, 4, '2026-11-21T02:00:00.000Z', { title: 'Hello Goodbye' }),
    episode(severance, 3, 1, '2026-11-23T02:00:00.000Z', {
      title: 'Hello, Ms. Cobel',
      episode_type: 'season_premiere',
    }),
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => episode(theBear, 5, n, '2026-11-25T02:00:00.000Z')),
    episode(andor, 2, 12, '2026-11-26T02:00:00.000Z', {
      title: 'Jedha, Kyber, Erso',
      episode_type: 'series_finale',
    }),
  ]),
  ...toMovieItems([movie('Dune: Part Three', '2026-12-18')], 'movie'),
  ...toMovieItems([movie('Wicked: For Good', '2026-11-24')], 'streaming'),
];

const progress = (s, aired, completed, season, number, title) => ({
  show: s,
  progress: {
    aired,
    completed,
    last_watched_at: '2026-11-19T21:00:00.000Z',
    next_episode: { season, number, title, ids: { trakt: next++ } },
  },
});
const upNext = [
  progress(shogun, 10, 7, 1, 8, 'The Abyss of Life'),
  progress(slowHorses, 27, 26, 6, 3, 'Uncivil War'),
  progress(severance, 19, 12, 2, 3, 'Who Is Alive?'),
].map(toUpNext);

const current = toWatching({
  type: 'movie',
  started_at: '2026-11-20T19:05:00.000Z',
  expires_at: '2026-11-20T21:47:00.000Z',
  action: 'scrobble',
  movie: {
    title: 'Dune: Part Two',
    year: 2024,
    ids: { trakt: next++, slug: 'dune-part-two-2024' },
    images: { poster: ['walter-r2.trakt.tv/images/movies/dune2/posters/thumb/p.jpg.webp'] },
  },
});

// Drawn posters: a color and a pattern per title, never the real artwork.
const PATTERNS = [
  (h) =>
    `<circle cx="100" cy="120" r="62" fill="none" stroke="hsl(${h},70%,85%)" stroke-width="12"/><rect x="30" y="220" width="140" height="10" fill="hsl(${h},70%,85%)"/>`,
  (h) => `<path d="M0 300 L100 70 L200 300 Z" fill="hsl(${h},60%,74%)"/>`,
  (h) =>
    `<rect x="40" y="60" width="120" height="120" fill="none" stroke="hsl(${h},70%,88%)" stroke-width="10"/><rect x="40" y="220" width="120" height="12" fill="hsl(${h},70%,88%)"/>`,
  (h) =>
    `<path d="M0 160 Q 50 90 100 160 T 200 160" fill="none" stroke="hsl(${h},70%,88%)" stroke-width="14"/>`,
  (h) =>
    `<circle cx="80" cy="110" r="45" fill="hsl(${h},60%,80%)"/><circle cx="125" cy="175" r="45" fill="hsl(${h},60%,66%)"/>`,
];
const posters = [
  ...items.map((item) => item.poster),
  ...upNext.map((s) => s.poster),
  current.poster,
];
const images = {};
[...new Set(posters)].forEach((url, index) => {
  const hue = (index * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300"><rect width="200" height="300" fill="hsl(${hue},45%,32%)"/>${PATTERNS[index % PATTERNS.length](hue)}</svg>`;
  images[imageKeyOf(url)] = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
});

const data = {
  items,
  upNext,
  watching: { current },
  today: TODAY,
  now: NOW,
  timeZone: TZ,
  config: normalizeConfig({}),
  linked: true,
  ready: true,
  fetchedAt: NOW - 25 * 60 * 1000,
  username: 'jane',
  posterKey: (url) => (url ? imageKeyOf(url) : null),
};
const contents = {};
for (const language of LANGUAGES) {
  contents[language] = {
    upcoming: buildUpcomingWidget({ ...data, settings: { count: '5' } }),
    up_next: buildUpNextWidget({ ...data, settings: { count: '3' } }),
    now_watching: buildWatchingWidget({ ...data, settings: {} }),
  };
}

const cards = Object.fromEntries(
  manifest.widgets.map((widget) => [widget.key, { icon: widget.icon, label: widget.label }]),
);
writeFileSync(out, JSON.stringify({ contents, images, cards }));
