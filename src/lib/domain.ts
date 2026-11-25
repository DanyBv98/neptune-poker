import type { DeckId, Member, Role, ThemeId, TicketKind, Track, Vote } from './types';

// ---------------------------------------------------------------- decks
export const DECKS: Record<DeckId, { label: string; cards: string[] }> = {
  fibonacci: { label: 'Fibonacci', cards: ['0', '1', '2', '3', '5', '8', '13', '21', '?', '☕'] },
  modified: { label: 'Modified Fibonacci', cards: ['0', '½', '1', '2', '3', '5', '8', '13', '20', '40', '100', '?', '☕'] },
  powers: { label: 'Powers of two', cards: ['0', '1', '2', '4', '8', '16', '32', '?', '☕'] },
  tshirt: { label: 'T-shirt sizes', cards: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '?', '☕'] },
};
const TSHIRT_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

export const THEMES: Record<ThemeId, { label: string; blurb: string }> = {
  neptune: { label: 'Neptune', blurb: 'Methane blue, Triton pink' },
  mars: { label: 'Mars', blurb: 'Rust and dust' },
  jupiter: { label: 'Jupiter', blurb: 'Storm bands' },
  saturn: { label: 'Saturn', blurb: 'Pale gold rings' },
  uranus: { label: 'Uranus', blurb: 'Cold cyan' },
};

/** Numeric value of a card, or null for '?', '☕' etc. T-shirt sizes map to their rank. */
export function cardNumber(value: string): number | null {
  if (value === '½') return 0.5;
  const ts = TSHIRT_ORDER.indexOf(value);
  if (ts >= 0) return ts + 1;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------- roles & tracks
export const ROLE_INFO: Record<Role, { label: string; short: string; hint: string }> = {
  FE: { label: 'Frontend', short: 'FE', hint: 'Votes on frontend tickets' },
  BE: { label: 'Backend', short: 'BE', hint: 'Votes on backend tickets' },
  FS: { label: 'Fullstack', short: 'FS', hint: 'Votes on frontend and backend; two votes on fullstack tickets' },
  QA: { label: 'QA', short: 'QA', hint: 'Votes on every ticket that needs QA' },
};
export const TRACK_LABEL: Record<Track, string> = { FE: 'Frontend', BE: 'Backend', QA: 'QA' };
export const KIND_LABEL: Record<TicketKind, string> = {
  FE: 'Frontend',
  BE: 'Backend',
  FS: 'Fullstack',
  QA: 'QA only',
  UNSET: 'No type',
};

const TRACK_ROLES: Record<Track, Role[]> = { FE: ['FE', 'FS'], BE: ['BE', 'FS'], QA: ['QA'] };

/** Same rule as public.role_can_vote() in the database. */
export function roleCanVote(roles: Role[], track: Track) {
  return TRACK_ROLES[track].some((r) => roles.includes(r));
}

export function eligibleTracks(roles: Role[], tracks: Track[]): Track[] {
  return tracks.filter((t) => roleCanVote(roles, t));
}

export interface ParsedTicket {
  title: string;
  url: string | null;
  kind: TicketKind;
  qaNeeded: boolean;
}

/**
 * Work out a ticket's type from tags in its name:
 *  [FE] → frontend, [BE] → backend, [QA] / [AQA] → QA only,
 *  [FE][BE] or [FS] / [Fullstack] → fullstack, [No QA] / [NOQA] → QA not needed.
 * Brackets or parentheses both work and case doesn't matter.
 */
export function deriveKind(title: string): { kind: TicketKind; qaNeeded: boolean } {
  const tags = Array.from(title.matchAll(/[[(]\s*([a-z -]{2,10}?)\s*[\])]/gi)).map((m) =>
    m[1].toUpperCase().replace(/[\s-]+/g, ''),
  );
  const has = (...t: string[]) => tags.some((x) => t.includes(x));
  const fe = has('FE', 'FRONTEND');
  const be = has('BE', 'BACKEND');
  const fs = has('FS', 'FULLSTACK');
  const qa = has('QA', 'AQA');
  const noQa = has('NOQA');
  let kind: TicketKind = 'UNSET';
  if (fs || (fe && be)) kind = 'FS';
  else if (fe) kind = 'FE';
  else if (be) kind = 'BE';
  else if (qa) kind = 'QA';
  return { kind, qaNeeded: kind === 'QA' ? true : !noQa };
}

/** Parse one pasted line: picks out a URL (or a Jira-style key) and the ticket type. */
export function parseTicketLine(line: string): ParsedTicket | null {
  const raw = line.trim().replace(/^[-*•]\s+/, '');
  if (!raw) return null;
  const urlMatch = raw.match(/https?:\/\/\S+/);
  const url = urlMatch ? urlMatch[0] : null;
  let title = (url ? raw.replace(url, '') : raw).replace(/\s{2,}/g, ' ').trim();
  if (!title && url) title = url.split('/').filter(Boolean).pop() ?? url;
  const { kind, qaNeeded } = deriveKind(title);
  return { title: title.slice(0, 300), url, kind, qaNeeded };
}

/** Which estimate tracks a round has, given its dev scope and whether QA is needed. */
export function tracksFor(scope: TicketKind, qaNeeded: boolean): Track[] {
  const t: Track[] = [];
  if (scope === 'FE' || scope === 'FS') t.push('FE');
  if (scope === 'BE' || scope === 'FS') t.push('BE');
  if (scope === 'QA' || qaNeeded) t.push('QA');
  return t;
}

/** Strip type tags from a title for display. */
export function cleanTitle(title: string) {
  return (
    title
      .replace(/[[(]\s*(fe|be|fs|qa|aqa|no ?-?qa|frontend|backend|full ?-?stack)\s*[\])]/gi, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s:–-]+/, '')
      .trim() || title
  );
}

// ---------------------------------------------------------------- results
export interface TrackStats {
  track: Track;
  votes: Vote[];
  numeric: number[];
  avg: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  consensus: boolean;
  distribution: { value: string; count: number }[];
  suggestion: string | null;
  low: Vote[];
  high: Vote[];
}

export function trackStats(track: Track, votes: Vote[], deck: DeckId): TrackStats {
  const mine = votes.filter((v) => v.track === track);
  const numeric = mine.map((v) => cardNumber(v.value)).filter((n): n is number => n !== null).sort((a, b) => a - b);
  const avg = numeric.length ? numeric.reduce((a, b) => a + b, 0) / numeric.length : null;
  const median = numeric.length
    ? numeric.length % 2
      ? numeric[(numeric.length - 1) / 2]
      : (numeric[numeric.length / 2 - 1] + numeric[numeric.length / 2]) / 2
    : null;
  const counts = new Map<string, number>();
  mine.forEach((v) => counts.set(v.value, (counts.get(v.value) ?? 0) + 1));
  const order = DECKS[deck].cards;
  const distribution = [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => order.indexOf(a.value) - order.indexOf(b.value));
  const numericValues = new Set(mine.filter((v) => cardNumber(v.value) !== null).map((v) => v.value));
  const consensus = mine.length >= 2 && numericValues.size === 1 && numeric.length === mine.length;
  const min = numeric[0] ?? null;
  const max = numeric[numeric.length - 1] ?? null;
  const spread = min !== null && max !== null && max > min;
  return {
    track,
    votes: mine,
    numeric,
    avg,
    median,
    min,
    max,
    consensus,
    distribution,
    suggestion: suggestCard(avg, deck),
    low: spread ? mine.filter((v) => cardNumber(v.value) === min) : [],
    high: spread ? mine.filter((v) => cardNumber(v.value) === max) : [],
  };
}

/** Nearest card to the average; ties go to the larger card (estimates round up). */
export function suggestCard(avg: number | null, deck: DeckId): string | null {
  if (avg === null) return null;
  let best: string | null = null;
  let bestDist = Infinity;
  for (const c of DECKS[deck].cards) {
    const n = cardNumber(c);
    if (n === null) continue;
    const d = Math.abs(n - avg);
    if (d < bestDist - 1e-9 || Math.abs(d - bestDist) < 1e-9) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

export function sumEstimates(est: Partial<Record<Track, string>>, deck: DeckId): number | null {
  if (deck === 'tshirt') return null;
  const nums = Object.values(est)
    .map((v) => (v ? cardNumber(v) : null))
    .filter((n): n is number => n !== null);
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}

export function fmt(n: number | null, digits = 1) {
  if (n === null) return '–';
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

export function memberVotesOn(member: Member, tracks: Track[]) {
  return eligibleTracks(member.roles, tracks).length > 0;
}

export const AVATARS = ['🐙', '🦑', '🐋', '🐬', '🐠', '🦈', '🐡', '🦀', '🪼', '🐢', '🦭', '🧜', '🔱', '🛰️', '🚀', '👾', '🦊', '🐧', '🦉', '🐸'];

export const NEPTUNE_FACTS = [
  'Neptune’s winds are the fastest measured on any planet — over 2,000 km/h.',
  'Neptune was found by maths before telescopes: Le Verrier predicted where it would be, Galle spotted it in 1846.',
  'One Neptune year lasts about 165 Earth years. It finished its first orbit since discovery in 2011.',
  'A day on Neptune is about 16 hours.',
  'Triton orbits Neptune backwards, which suggests it was captured from the Kuiper belt.',
  'Triton has geysers that shoot nitrogen gas kilometres above its frozen surface.',
  'Voyager 2 is the only spacecraft to have visited Neptune, flying past in 1989.',
  'Voyager 2 photographed the Great Dark Spot, a storm about as wide as Earth. It had vanished by 1994.',
  'Neptune’s blue comes from methane in its atmosphere absorbing red light.',
  'Neptune has faint rings named after the astronomers who worked on its discovery.',
  'Neptune radiates more than twice the heat it receives from the Sun.',
  'Sunlight takes roughly four hours to reach Neptune.',
];
