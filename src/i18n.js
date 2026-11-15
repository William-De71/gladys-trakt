// -----------------------------------------------------------------------------
// Texts of the integration, in English, French, German and Spanish (English
// fallback).
//
// The manifest carries its own labels; these are the texts the code writes at
// runtime: the calendar, widget contents, connection status, results of the
// configuration buttons, scene data. Vocabulary of the Gladys interface
// (calendrier / Kalender / calendario, scène / Szene / escena). Titles stay as
// Trakt writes them.
// -----------------------------------------------------------------------------

import { daysBetween } from './time.js';

const LANGUAGES = ['en', 'fr', 'de', 'es'];

const KIND_NAMES = {
  episode: { en: 'Episode', fr: 'Épisode', de: 'Folge', es: 'Episodio' },
  movie: { en: 'Movie', fr: 'Film', de: 'Film', es: 'Película' },
  streaming: { en: 'Streaming', fr: 'Streaming', de: 'Streaming', es: 'Streaming' },
};

const TEXTS = {
  // Calendar
  calendarName: {
    en: 'Shows and movies',
    fr: 'Séries et films',
    de: 'Serien und Filme',
    es: 'Series y películas',
  },
  calendarDescription: {
    en: 'Episodes and releases of your Trakt account.',
    fr: 'Les épisodes et les sorties de votre compte Trakt.',
    de: 'Folgen und Veröffentlichungen Ihres Trakt-Kontos.',
    es: 'Episodios y estrenos de su cuenta de Trakt.',
  },
  eventFooter: {
    en: '{details} · Source: Trakt',
    fr: '{details} · Source : Trakt',
    de: '{details} · Quelle: Trakt',
    es: '{details} · Fuente: Trakt',
  },

  // Distances
  today: { en: 'Today', fr: 'Aujourd’hui', de: 'Heute', es: 'Hoy' },
  tomorrow: { en: 'Tomorrow', fr: 'Demain', de: 'Morgen', es: 'Mañana' },
  yesterday: { en: 'Yesterday', fr: 'Hier', de: 'Gestern', es: 'Ayer' },
  inDays: {
    en: 'in {days} days',
    fr: 'dans {days} jours',
    de: 'in {days} Tagen',
    es: 'en {days} días',
  },
  daysAgo: {
    en: '{days} days ago',
    fr: 'il y a {days} jours',
    de: 'vor {days} Tagen',
    es: 'hace {days} días',
  },

  // Widgets
  sourceCaption: {
    en: 'Trakt · {user} · read at {time}',
    fr: 'Trakt · {user} · lu à {time}',
    de: 'Trakt · {user} · gelesen um {time}',
    es: 'Trakt · {user} · leído a las {time}',
  },
  sourceCaptionNever: {
    en: 'Trakt · not read yet',
    fr: 'Trakt · pas encore lu',
    de: 'Trakt · noch nicht gelesen',
    es: 'Trakt · aún sin leer',
  },
  notLinked: {
    en: 'Link your Trakt account in the configuration of the integration.',
    fr: 'Reliez votre compte Trakt dans la configuration de l’intégration.',
    de: 'Verknüpfen Sie Ihr Trakt-Konto in der Konfiguration der Integration.',
    es: 'Vincule su cuenta de Trakt en la configuración de la integración.',
  },
  reading: {
    en: 'Reading your Trakt account…',
    fr: 'Lecture de votre compte Trakt…',
    de: 'Ihr Trakt-Konto wird gelesen…',
    es: 'Leyendo su cuenta de Trakt…',
  },
  noUpcoming: {
    en: 'Nothing in your Trakt calendar for the coming days.',
    fr: 'Rien dans votre calendrier Trakt pour les jours à venir.',
    de: 'Nichts in Ihrem Trakt-Kalender für die nächsten Tage.',
    es: 'Nada en su calendario de Trakt para los próximos días.',
  },
  noUpNext: {
    en: 'No show in progress.',
    fr: 'Aucune série en cours.',
    de: 'Keine laufende Serie.',
    es: 'Ninguna serie en curso.',
  },
  badgePremiere: { en: 'Premiere', fr: 'Première', de: 'Premiere', es: 'Estreno' },
  badgeFinale: { en: 'Finale', fr: 'Final', de: 'Finale', es: 'Final' },
  linkTrakt: {
    en: 'Open on Trakt',
    fr: 'Ouvrir sur Trakt',
    de: 'Auf Trakt öffnen',
    es: 'Abrir en Trakt',
  },
  detailWatched: {
    en: 'Episodes watched: {completed} of {aired}',
    fr: 'Épisodes vus : {completed} sur {aired}',
    de: 'Gesehene Folgen: {completed} von {aired}',
    es: 'Episodios vistos: {completed} de {aired}',
  },
  detailLeft: {
    en: 'Episodes left: {left}',
    fr: 'Épisodes restants : {left}',
    de: 'Verbleibende Folgen: {left}',
    es: 'Episodios restantes: {left}',
  },
  watchingOff: {
    en: 'The “Now watching” option is turned off in the configuration.',
    fr: 'L’option « Lecture en cours » est désactivée dans la configuration.',
    de: 'Die Option „Aktuelle Wiedergabe“ ist in der Konfiguration deaktiviert.',
    es: 'La opción «Reproducción en curso» está desactivada en la configuración.',
  },
  nothingPlaying: {
    en: 'Nothing is playing.',
    fr: 'Aucune lecture en cours.',
    de: 'Es läuft nichts.',
    es: 'No se está reproduciendo nada.',
  },
  statusLast: { en: 'Last watched', fr: 'Dernier vu', de: 'Zuletzt gesehen', es: 'Último visto' },
  statusStopped: { en: 'Stopped', fr: 'Arrêté', de: 'Beendet', es: 'Detenido' },
  minutes: { en: '{minutes} min', fr: '{minutes} min', de: '{minutes} Min.', es: '{minutes} min' },
  tileLeft: { en: 'Left', fr: 'Restant', de: 'Verbleibend', es: 'Restante' },
  tileStarted: { en: 'Started', fr: 'Début', de: 'Beginn', es: 'Inicio' },
  tileEnds: { en: 'Ends', fr: 'Fin', de: 'Ende', es: 'Fin' },
  posterAlt: {
    en: 'Poster of {title}',
    fr: 'Affiche de {title}',
    de: 'Poster von {title}',
    es: 'Póster de {title}',
  },

  // Connection status
  statusNoClient: {
    en: 'Enter the Client ID of your Trakt app, save, then click Connect.',
    fr: 'Saisissez le Client ID de votre app Trakt, enregistrez, puis cliquez sur Connecter.',
    de: 'Geben Sie die Client-ID Ihrer Trakt-App ein, speichern Sie und klicken Sie auf Verbinden.',
    es: 'Introduzca el Client ID de su app de Trakt, guarde y pulse Conectar.',
  },
  statusNotLinked: {
    en: 'Not linked: click Connect in the configuration.',
    fr: 'Compte non relié : cliquez sur Connecter dans la configuration.',
    de: 'Nicht verknüpft: Klicken Sie in der Konfiguration auf Verbinden.',
    es: 'Sin vincular: pulse Conectar en la configuración.',
  },
  statusEnterCode: {
    en: 'Type the code {code} on {url} (signed in to Trakt).',
    fr: 'Saisissez le code {code} sur {url} (connecté à Trakt).',
    de: 'Geben Sie den Code {code} auf {url} ein (bei Trakt angemeldet).',
    es: 'Escriba el código {code} en {url} (con la sesión de Trakt iniciada).',
  },
  statusSignIn_denied: {
    en: 'The code was denied on Trakt. Click Connect to try again.',
    fr: 'Le code a été refusé sur Trakt. Cliquez sur Connecter pour réessayer.',
    de: 'Der Code wurde auf Trakt abgelehnt. Klicken Sie auf Verbinden, um es erneut zu versuchen.',
    es: 'El código fue rechazado en Trakt. Pulse Conectar para reintentar.',
  },
  statusSignIn_expired: {
    en: 'The code expired before it was typed. Click Connect to get a new one.',
    fr: 'Le code a expiré avant d’être saisi. Cliquez sur Connecter pour en obtenir un nouveau.',
    de: 'Der Code ist abgelaufen. Klicken Sie auf Verbinden, um einen neuen zu erhalten.',
    es: 'El código caducó antes de escribirlo. Pulse Conectar para obtener otro.',
  },
  statusSignIn_other: {
    en: 'The sign-in failed (see the logs). Click Connect to try again.',
    fr: 'La connexion a échoué (voir les journaux). Cliquez sur Connecter pour réessayer.',
    de: 'Die Anmeldung ist fehlgeschlagen (siehe Protokolle). Klicken Sie erneut auf Verbinden.',
    es: 'El inicio de sesión falló (vea los registros). Pulse Conectar para reintentar.',
  },
  statusReconnect: {
    en: 'Trakt refuses the sign-in: click Connect again in the configuration.',
    fr: 'Trakt refuse la connexion : cliquez de nouveau sur Connecter dans la configuration.',
    de: 'Trakt lehnt die Anmeldung ab: Klicken Sie in der Konfiguration erneut auf Verbinden.',
    es: 'Trakt rechaza la sesión: pulse de nuevo Conectar en la configuración.',
  },
  statusPaused: {
    en: 'Trakt asked to slow down: readings resume at {time}.',
    fr: 'Trakt demande de ralentir : les lectures reprennent à {time}.',
    de: 'Trakt bittet um Verlangsamung: Die Abfragen werden um {time} fortgesetzt.',
    es: 'Trakt pide ir más despacio: las lecturas se reanudan a las {time}.',
  },
  statusForbidden: {
    en: 'Trakt refuses the Client ID (deleted or unapproved app). Check it in “My Apps”.',
    fr: 'Trakt refuse le Client ID (app supprimée ou non approuvée). Vérifiez-le dans « My Apps ».',
    de: 'Trakt lehnt die Client-ID ab (App gelöscht oder nicht freigegeben). Prüfen Sie sie unter „My Apps“.',
    es: 'Trakt rechaza el Client ID (app eliminada o no aprobada). Compruébelo en «My Apps».',
  },
  statusUnreachable: {
    en: 'Trakt cannot be read: {error}',
    fr: 'Lecture de Trakt impossible : {error}',
    de: 'Trakt kann nicht gelesen werden: {error}',
    es: 'No se puede leer Trakt: {error}',
  },
  statusReading: {
    en: 'Linked. Reading your Trakt account…',
    fr: 'Compte relié. Lecture de votre compte Trakt…',
    de: 'Verknüpft. Ihr Trakt-Konto wird gelesen…',
    es: 'Vinculada. Leyendo su cuenta de Trakt…',
  },
  statusOk: {
    en: 'Linked to {user} · items to come: {upcoming}.',
    fr: 'Relié à {user} · éléments à venir : {upcoming}.',
    de: 'Verknüpft mit {user} · kommende Einträge: {upcoming}.',
    es: 'Vinculada a {user} · elementos próximos: {upcoming}.',
  },
  signInBadClient: {
    en: 'Trakt does not know this Client ID. Copy it again from “My Apps” on trakt.tv, save, then click Connect.',
    fr: 'Trakt ne connaît pas ce Client ID. Recopiez-le depuis « My Apps » sur trakt.tv, enregistrez, puis cliquez sur Connecter.',
    de: 'Trakt kennt diese Client-ID nicht. Kopieren Sie sie erneut aus „My Apps“ auf trakt.tv, speichern Sie und klicken Sie auf Verbinden.',
    es: 'Trakt no conoce este Client ID. Cópielo de nuevo desde «My Apps» en trakt.tv, guarde y pulse Conectar.',
  },
  signInStartFailed: {
    en: 'The sign-in could not start: {reason}',
    fr: 'La connexion n’a pas pu démarrer : {reason}',
    de: 'Die Anmeldung konnte nicht gestartet werden: {reason}',
    es: 'No se pudo iniciar la sesión: {reason}',
  },

  // Configuration buttons
  refreshRunning: {
    en: 'A reading is already running.',
    fr: 'Une lecture est déjà en cours.',
    de: 'Eine Abfrage läuft bereits.',
    es: 'Ya hay una lectura en curso.',
  },
  refreshFailed: {
    en: 'The reading failed: {error}',
    fr: 'La lecture a échoué : {error}',
    de: 'Die Abfrage ist fehlgeschlagen: {error}',
    es: 'La lectura falló: {error}',
  },
  refreshed: {
    en: 'Read. Items to come: {upcoming} · shows in progress: {shows}.',
    fr: 'Lu. Éléments à venir : {upcoming} · séries en cours : {shows}.',
    de: 'Gelesen. Kommende Einträge: {upcoming} · laufende Serien: {shows}.',
    es: 'Leído. Elementos próximos: {upcoming} · series en curso: {shows}.',
  },
  disconnected: {
    en: 'Disconnected: the tokens and what was read are forgotten. To finish, revoke the app in your Trakt settings.',
    fr: 'Déconnecté : les jetons et ce qui avait été lu sont oubliés. Pour finir, révoquez l’app dans vos réglages Trakt.',
    de: 'Getrennt: Die Tokens und das Gelesene wurden verworfen. Widerrufen Sie zum Abschluss die App in Ihren Trakt-Einstellungen.',
    es: 'Desconectada: los tokens y lo leído se han olvidado. Para terminar, revoque la app en sus ajustes de Trakt.',
  },

  // Scene sentences
  textDisconnected: {
    en: 'Trakt refuses the sign-in of Gladys: connect the account again.',
    fr: 'Trakt refuse la connexion de Gladys : reliez de nouveau le compte.',
    de: 'Trakt lehnt die Anmeldung von Gladys ab: Verknüpfen Sie das Konto erneut.',
    es: 'Trakt rechaza la sesión de Gladys: vuelva a vincular la cuenta.',
  },
  textTodayEpisode: {
    en: '{title} airs today at {time}.',
    fr: '{title} est diffusé aujourd’hui à {time}.',
    de: '{title} läuft heute um {time}.',
    es: '{title} se emite hoy a las {time}.',
  },
  textTomorrowEpisode: {
    en: '{title} airs tomorrow at {time}.',
    fr: '{title} est diffusé demain à {time}.',
    de: '{title} läuft morgen um {time}.',
    es: '{title} se emite mañana a las {time}.',
  },
  textInDaysEpisode: {
    en: '{title} airs in {days} days, on {date}.',
    fr: '{title} est diffusé dans {days} jours, le {date}.',
    de: '{title} läuft in {days} Tagen, am {date}.',
    es: '{title} se emite en {days} días, el {date}.',
  },
  textPastEpisode: {
    en: '{title} aired on {date}.',
    fr: '{title} a été diffusé le {date}.',
    de: '{title} lief am {date}.',
    es: '{title} se emitió el {date}.',
  },
  textTodayMovie: {
    en: '{title} is released today.',
    fr: '{title} sort aujourd’hui.',
    de: '{title} erscheint heute.',
    es: '{title} se estrena hoy.',
  },
  textTomorrowMovie: {
    en: '{title} is released tomorrow.',
    fr: '{title} sort demain.',
    de: '{title} erscheint morgen.',
    es: '{title} se estrena mañana.',
  },
  textInDaysMovie: {
    en: '{title} is released in {days} days, on {date}.',
    fr: '{title} sort dans {days} jours, le {date}.',
    de: '{title} erscheint in {days} Tagen, am {date}.',
    es: '{title} se estrena en {days} días, el {date}.',
  },
  textPastMovie: {
    en: '{title} was released on {date}.',
    fr: '{title} est sorti le {date}.',
    de: '{title} ist am {date} erschienen.',
    es: '{title} se estrenó el {date}.',
  },
  textTodayStreaming: {
    en: '{title} arrives on streaming today.',
    fr: '{title} arrive en streaming aujourd’hui.',
    de: '{title} ist ab heute im Streaming verfügbar.',
    es: '{title} llega hoy al streaming.',
  },
  textTomorrowStreaming: {
    en: '{title} arrives on streaming tomorrow.',
    fr: '{title} arrive en streaming demain.',
    de: '{title} ist ab morgen im Streaming verfügbar.',
    es: '{title} llega mañana al streaming.',
  },
  textInDaysStreaming: {
    en: '{title} arrives on streaming in {days} days, on {date}.',
    fr: '{title} arrive en streaming dans {days} jours, le {date}.',
    de: '{title} ist in {days} Tagen, am {date}, im Streaming verfügbar.',
    es: '{title} llega al streaming en {days} días, el {date}.',
  },
  textPastStreaming: {
    en: '{title} arrived on streaming on {date}.',
    fr: '{title} est arrivé en streaming le {date}.',
    de: '{title} ist seit dem {date} im Streaming verfügbar.',
    es: '{title} llegó al streaming el {date}.',
  },
  textAnnouncedEpisode: {
    en: 'New in your Trakt calendar: {title}, on {date}.',
    fr: 'Nouveau dans votre calendrier Trakt : {title}, le {date}.',
    de: 'Neu in Ihrem Trakt-Kalender: {title}, am {date}.',
    es: 'Nuevo en su calendario de Trakt: {title}, el {date}.',
  },
  textAnnouncedMovie: {
    en: 'New in your Trakt calendar: {title} ({kind}), on {date}.',
    fr: 'Nouveau dans votre calendrier Trakt : {title} ({kind}), le {date}.',
    de: 'Neu in Ihrem Trakt-Kalender: {title} ({kind}), am {date}.',
    es: 'Nuevo en su calendario de Trakt: {title} ({kind}), el {date}.',
  },
  textDateChanged: {
    en: '{title} moved to {date} (it was {previous}).',
    fr: '{title} est déplacé au {date} (c’était le {previous}).',
    de: '{title} wurde auf {date} verschoben (bisher {previous}).',
    es: '{title} pasa al {date} (era el {previous}).',
  },
  textAiring: {
    en: '{title} airs now.',
    fr: '{title} est diffusé maintenant.',
    de: '{title} läuft jetzt.',
    es: '{title} se emite ahora.',
  },
  textWatchingStarted: {
    en: 'Now watching: {title}.',
    fr: 'Lecture en cours : {title}.',
    de: 'Aktuelle Wiedergabe: {title}.',
    es: 'Reproduciendo: {title}.',
  },
  textWatchingStopped: {
    en: 'Playback stopped: {title}.',
    fr: 'Lecture arrêtée : {title}.',
    de: 'Wiedergabe gestoppt: {title}.',
    es: 'Reproducción detenida: {title}.',
  },
  textWatchingFinished: {
    en: 'Finished: {title}.',
    fr: 'Terminé : {title}.',
    de: 'Beendet: {title}.',
    es: 'Terminado: {title}.',
  },
  textNone: {
    en: 'Nothing to come in your Trakt calendar.',
    fr: 'Rien à venir dans votre calendrier Trakt.',
    de: 'Nichts Kommendes in Ihrem Trakt-Kalender.',
    es: 'Nada próximo en su calendario de Trakt.',
  },

  // Scene actions that write
  writeNotFound: {
    en: 'Trakt found nothing for “{query}”.',
    fr: 'Trakt n’a rien trouvé pour « {query} ».',
    de: 'Trakt hat nichts zu „{query}“ gefunden.',
    es: 'Trakt no encontró nada para «{query}».',
  },
  writeLimit: {
    en: 'The watchlist of the account is full (limit of the Trakt plan).',
    fr: 'La watchlist du compte est pleine (limite de l’offre Trakt).',
    de: 'Die Watchlist des Kontos ist voll (Limit des Trakt-Tarifs).',
    es: 'La watchlist de la cuenta está llena (límite del plan de Trakt).',
  },
  writeAdded: {
    en: '{title} was added to the watchlist.',
    fr: '{title} a été ajouté à la watchlist.',
    de: '{title} wurde zur Watchlist hinzugefügt.',
    es: '{title} se añadió a la watchlist.',
  },
  writeExisting: {
    en: '{title} is already in the watchlist.',
    fr: '{title} est déjà dans la watchlist.',
    de: '{title} steht bereits auf der Watchlist.',
    es: '{title} ya está en la watchlist.',
  },
  writeNoNext: {
    en: 'No show in progress matches “{query}”.',
    fr: 'Aucune série en cours ne correspond à « {query} ».',
    de: 'Keine laufende Serie passt zu „{query}“.',
    es: 'Ninguna serie en curso coincide con «{query}».',
  },
  writeAlready: {
    en: '{title} was already marked as watched less than an hour ago.',
    fr: '{title} a déjà été marqué comme vu il y a moins d’une heure.',
    de: '{title} wurde bereits vor weniger als einer Stunde als gesehen markiert.',
    es: '{title} ya se marcó como visto hace menos de una hora.',
  },
  writeMarked: {
    en: '{title} is marked as watched.',
    fr: '{title} est marqué comme vu.',
    de: '{title} ist als gesehen markiert.',
    es: '{title} está marcado como visto.',
  },
};

const isLanguage = (value) => LANGUAGES.includes(value);

/**
 * @description A text in one language, its `{placeholders}` replaced.
 * @param {string} key - A TEXTS key.
 * @param {string} language - en, fr, de or es (English otherwise).
 * @param {object} [values] - The values of the placeholders.
 * @returns {string} The text.
 */
function t(key, language, values = {}) {
  const entry = TEXTS[key];
  if (!entry) {
    return key;
  }
  const template = entry[isLanguage(language) ? language : 'en'] ?? entry.en;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    values[name] === undefined || values[name] === null ? '' : String(values[name]),
  );
}

/**
 * @description A text in the four languages.
 * @param {string} key - A TEXTS key.
 * @param {object|Function} [values] - The values, or `(language) => values`.
 * @returns {object} `{ en, fr, de, es }`.
 */
function all(key, values = {}) {
  return Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      t(key, language, typeof values === 'function' ? values(language) : values),
    ]),
  );
}

/**
 * @description A text built per language.
 * @param {Function} build - `(language) => string`.
 * @returns {object} `{ en, fr, de, es }`.
 */
const each = (build) =>
  Object.fromEntries(LANGUAGES.map((language) => [language, build(language)]));

const named = (table) => (key, language) => {
  const entry = table[key];
  if (!entry) {
    return String(key ?? '');
  }
  return entry[isLanguage(language) ? language : 'en'] ?? entry.en;
};

/** The name of a kind of item: `kindName('episode', 'fr')`. */
const kindName = named(KIND_NAMES);

/**
 * @description How far a day is: "Today", "in 6 days", "3 days ago".
 * @param {string} date - `YYYY-MM-DD`.
 * @param {string} today - `YYYY-MM-DD`.
 * @param {string} language - The language.
 * @returns {string} The text.
 */
function distanceText(date, today, language) {
  const days = daysBetween(today, date);
  if (days === 0) {
    return t('today', language);
  }
  if (days === 1) {
    return t('tomorrow', language);
  }
  if (days === -1) {
    return t('yesterday', language);
  }
  return days > 0 ? t('inDays', language, { days }) : t('daysAgo', language, { days: -days });
}

/**
 * @description Cut a text to a length, with an ellipsis.
 * @param {unknown} value - The text.
 * @param {number} max - The maximum length.
 * @returns {string} The text, at most `max` characters.
 */
function truncate(value, max) {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export { LANGUAGES, KIND_NAMES, TEXTS, isLanguage, t, all, each, kindName, distanceText, truncate };
