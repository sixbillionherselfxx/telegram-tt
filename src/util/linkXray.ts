import convertPunycode from '../lib/punycode';
import { ensureProtocol } from './browser/url';

export type LinkXrayReason = 'lookalike' | 'otherEnding' | 'freeHosting' | 'brandMention';

export type LinkXray = {
  host: string;
  ownerDomain: string;
  // Domain as the registry knows it, with punycode kept
  ownerDomainAscii: string;
  isFreeHosting: boolean;
  target: string;
  reason: LinkXrayReason;
  // One flag per `host` character, set for characters that differ from the imitated address
  markedCharacters: boolean[];
};

type OfficialSite = {
  domain: string;
  // Name to look for in other addresses; empty for generic words like "wallet"
  keyword?: string;
  // Generic words only match as a whole part of the address, without fuzzy comparison
  isStrict?: boolean;
  // Global brands own their name in many country endings (google.de, amazon.co.uk)
  hasCountryDomains?: boolean;
};

const OFFICIAL_SITES: OfficialSite[] = [
  // Telegram and TON
  { domain: 'telegram.org' },
  { domain: 't.me' },
  { domain: 'telegram.me' },
  { domain: 'telegram.dog' },
  { domain: 'telegra.ph', isStrict: true },
  { domain: 'telesco.pe', isStrict: true },
  { domain: 'tg.dev' },
  { domain: 'fragment.com', isStrict: true },
  { domain: 'wallet.tg', keyword: '' },
  { domain: 'ton.org', isStrict: true },
  { domain: 'tonkeeper.com' },
  { domain: 'tonhub.com' },
  { domain: 'tonviewer.com' },
  { domain: 'tonscan.org' },
  { domain: 'mytonwallet.io' },
  // Crypto exchanges and wallets
  { domain: 'binance.com' },
  { domain: 'bybit.com', isStrict: true },
  { domain: 'okx.com', isStrict: true },
  { domain: 'coinbase.com' },
  { domain: 'kraken.com', isStrict: true },
  { domain: 'kucoin.com' },
  { domain: 'bitget.com' },
  { domain: 'metamask.io' },
  { domain: 'trustwallet.com' },
  { domain: 'phantom.app', isStrict: true },
  { domain: 'ledger.com', isStrict: true },
  // Payments and banks
  { domain: 'paypal.com', hasCountryDomains: true },
  { domain: 'revolut.com' },
  { domain: 'sberbank.ru' },
  { domain: 'sber.ru', isStrict: true },
  { domain: 'tbank.ru', isStrict: true },
  { domain: 'tinkoff.ru' },
  { domain: 'alfabank.ru' },
  { domain: 'gosuslugi.ru' },
  { domain: 'kaspi.kz', isStrict: true },
  { domain: 'monobank.ua' },
  { domain: 'privatbank.ua' },
  { domain: 'privat24.ua' },
  // Large services
  { domain: 'google.com', hasCountryDomains: true },
  { domain: 'apple.com', isStrict: true, hasCountryDomains: true },
  { domain: 'icloud.com' },
  { domain: 'microsoft.com', hasCountryDomains: true },
  { domain: 'outlook.com' },
  { domain: 'facebook.com' },
  { domain: 'instagram.com' },
  { domain: 'whatsapp.com' },
  { domain: 'twitter.com' },
  { domain: 'discord.com' },
  { domain: 'steampowered.com' },
  { domain: 'steamcommunity.com' },
  { domain: 'netflix.com', hasCountryDomains: true },
  { domain: 'amazon.com', hasCountryDomains: true },
  { domain: 'github.com' },
  { domain: 'yandex.ru', hasCountryDomains: true },
  { domain: 'wildberries.ru', hasCountryDomains: true },
  { domain: 'ozon.ru', isStrict: true, hasCountryDomains: true },
  { domain: 'avito.ru', isStrict: true },
];

// Free hosting and site builders where anyone gets a subdomain in a minute
const FREE_HOSTING_SUFFIXES = [
  'pages.dev', 'workers.dev', 'r2.dev', 'vercel.app', 'netlify.app', 'github.io', 'gitlab.io',
  'web.app', 'firebaseapp.com', 'appspot.com', 'herokuapp.com', 'onrender.com', 'fly.dev',
  'railway.app', 'deno.dev', 'glitch.me', 'replit.app', 'repl.co', 'surge.sh', 'ngrok.io',
  'ngrok.app', 'ngrok-free.app', 'webflow.io', 'framer.website', 'framer.app', 'wixsite.com',
  'weebly.com', 'blogspot.com', '000webhostapp.com', 'azurewebsites.net', 'square.site',
  'godaddysites.com', 'carrd.co', 'notion.site', 'gitbook.io', 'tilda.ws', 'pythonanywhere.com',
];

// Second-level endings that belong to a country, like co.uk or com.ua
const COUNTRY_SECOND_LEVELS = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne']);

// Letters and digits that look alike in a link, mapped to the Latin letter they imitate
const HOMOGLYPHS: Record<string, string> = {
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
  і: 'l', ї: 'l', ј: 'j', ԁ: 'd', ѕ: 's', ԛ: 'q', ԝ: 'w', һ: 'h', ӏ: 'l',
  α: 'a', β: 'b', ε: 'e', ι: 'l', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x',
  0: 'o', 1: 'l', 3: 'e', 5: 's', i: 'l', ı: 'l', '|': 'l',
};
const MULTI_GLYPHS: [RegExp, string][] = [[/rn/g, 'm'], [/vv/g, 'w'], [/cl/g, 'd']];
const IGNORED_CHARACTERS = /[-_]/g;
const TOKEN_SEPARATOR = /[-_.\d]+/;
const IP_PATTERN = /^[\d.]+$|^\[.*\]$/;
const MIN_FUZZY_LENGTH = 6;
const MIN_SUBSTRING_LENGTH = 6;
const MIN_TOKEN_LENGTH = 3;

const RDAP_URL = 'https://rdap.org/domain/';
const RDAP_TIMEOUT = 10000;

const cache = new Map<string, LinkXray | undefined>();

export function getLinkXray(url: string) {
  if (cache.has(url)) return cache.get(url);

  let result: LinkXray | undefined;
  try {
    result = analyzeLink(url);
  } catch (err) {
    result = undefined;
  }

  cache.set(url, result);
  return result;
}

// Asks the public domain registry when the domain was registered. Called only after the user taps the button
export async function fetchDomainRegistrationDate(domain: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RDAP_TIMEOUT);

  try {
    const response = await fetch(`${RDAP_URL}${encodeURIComponent(domain)}`, {
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) return undefined;

    const data = await response.json() as { events?: { eventAction?: string; eventDate?: string }[] };
    const registration = data.events?.find(({ eventAction }) => eventAction === 'registration');
    const date = registration?.eventDate ? Date.parse(registration.eventDate) : NaN;

    return Number.isNaN(date) ? undefined : date;
  } catch (err) {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function analyzeLink(url: string): LinkXray | undefined {
  const { protocol, hostname } = new URL(ensureProtocol(url));
  if (protocol !== 'http:' && protocol !== 'https:') return undefined;

  const host = convertPunycode(hostname).toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  if (!host || IP_PATTERN.test(host) || !host.includes('.')) return undefined;
  if (OFFICIAL_SITES.some(({ domain }) => isSameOrSubdomain(host, domain))) return undefined;

  const { ownerDomain, name, subdomainLabels, isFreeHosting } = splitHost(host);
  const normalizedName = normalize(name);
  const tokens = [name, ...subdomainLabels].flatMap((part) => part.split(TOKEN_SEPARATOR))
    .filter((token) => token.length >= MIN_TOKEN_LENGTH)
    .map(normalize);
  const hostLength = Array.from(host).length;
  const nameLength = Array.from(name).length;
  const nameStart = hostLength - Array.from(ownerDomain).length;

  let best: LinkXray | undefined;
  for (const site of OFFICIAL_SITES) {
    const key = site.keyword ?? site.domain.split('.')[0];
    if (key.length < MIN_TOKEN_LENGTH) continue;
    const normalizedKey = normalize(key);

    let reason: LinkXrayReason | undefined;
    let markedCharacters: boolean[] | undefined;

    if (!isFreeHosting && name === key) {
      if (!site.hasCountryDomains) {
        reason = 'otherEnding';
        markedCharacters = Array.from(host, (_, index) => index >= nameStart + nameLength);
      }
    } else if (!isFreeHosting && isLookalikeName(normalizedName, normalizedKey, site)) {
      reason = 'lookalike';
      const nameMarks = getChangedCharacters(name, key);
      markedCharacters = Array.from(host, (_, index) => (
        index >= nameStart && index < nameStart + nameLength && nameMarks[index - nameStart]
      ));
    } else if (tokens.some((token) => isBrandMention(token, normalizedKey, site))) {
      reason = isFreeHosting ? 'freeHosting' : 'brandMention';
      // Point at the part of the address that really owns the site
      const ownerStart = isFreeHosting ? nameStart + nameLength + 1 : nameStart;
      markedCharacters = Array.from(host, (_, index) => index >= ownerStart);
    }

    if (reason && (!best || REASON_PRIORITY[reason] > REASON_PRIORITY[best.reason])) {
      best = {
        host,
        ownerDomain,
        ownerDomainAscii: hostname.replace(/\.$/, '').split('.').slice(-ownerDomain.split('.').length).join('.'),
        isFreeHosting,
        target: site.domain,
        reason,
        markedCharacters: markedCharacters!,
      };
    }
  }

  return best;
}

const REASON_PRIORITY: Record<LinkXrayReason, number> = {
  brandMention: 1,
  freeHosting: 2,
  lookalike: 3,
  otherEnding: 4,
};

function isSameOrSubdomain(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

function splitHost(host: string) {
  const labels = host.split('.');
  const hostingSuffix = FREE_HOSTING_SUFFIXES.find((suffix) => host.endsWith(`.${suffix}`));

  let suffixLength = 1;
  if (hostingSuffix) {
    suffixLength = hostingSuffix.split('.').length;
  } else if (labels.length > 2 && labels.at(-1)!.length === 2 && COUNTRY_SECOND_LEVELS.has(labels.at(-2)!)) {
    suffixLength = 2;
  }

  const nameIndex = Math.max(0, labels.length - suffixLength - 1);
  return {
    ownerDomain: labels.slice(nameIndex).join('.'),
    name: labels[nameIndex],
    subdomainLabels: labels.slice(0, nameIndex),
    isFreeHosting: Boolean(hostingSuffix),
  };
}

function normalize(text: string) {
  let result = Array.from(text.replace(IGNORED_CHARACTERS, ''), (character) => HOMOGLYPHS[character] || character)
    .join('');
  for (const [pattern, replacement] of MULTI_GLYPHS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function isLookalikeName(name: string, key: string, site: OfficialSite) {
  if (name === key) return true;
  if (site.isStrict || key.length < MIN_FUZZY_LENGTH) return false;

  return getEditDistance(name, key) <= 1;
}

function isBrandMention(token: string, key: string, site: OfficialSite) {
  if (token === key) return true;
  if (site.isStrict) return false;
  if (key.length >= MIN_SUBSTRING_LENGTH && token.includes(key)) return true;

  return key.length >= MIN_FUZZY_LENGTH && token.length >= MIN_FUZZY_LENGTH && getEditDistance(token, key) <= 1;
}

function buildDistanceTable(a: string[], b: string[]) {
  const table = Array.from({ length: a.length + 1 }, (_, i) => (
    Array.from({ length: b.length + 1 }, (__, j) => (i === 0 ? j : j === 0 ? i : 0))
  ));

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      table[i][j] = Math.min(
        table[i - 1][j] + 1,
        table[i][j - 1] + 1,
        table[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }

  return table;
}

function getEditDistance(a: string, b: string) {
  const aChars = Array.from(a);
  const bChars = Array.from(b);
  return buildDistanceTable(aChars, bChars)[aChars.length][bChars.length];
}

// Marks characters of `text` that were swapped or added compared to `original`
function getChangedCharacters(text: string, original: string) {
  const a = Array.from(text);
  const b = Array.from(original);
  const table = buildDistanceTable(a, b);
  const marks = a.map(() => false);

  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1] && table[i][j] === table[i - 1][j - 1]) {
      i--;
      j--;
    } else if (table[i][j] === table[i - 1][j - 1] + 1) {
      marks[--i] = true;
      j--;
    } else if (table[i][j] === table[i - 1][j] + 1) {
      marks[--i] = true;
    } else {
      j--;
    }
  }
  while (i > 0) marks[--i] = true;

  return marks;
}
