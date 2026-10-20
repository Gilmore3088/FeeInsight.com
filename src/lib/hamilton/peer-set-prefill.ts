import { DISPLAY_NAMES } from "@/lib/fee-taxonomy";

/**
 * A peer set handed to Hamilton by a public page (#1981): the institution page's peer explorer links
 * to `/pro/settings?instId=<id>&peers=<id>,<id>&name=<label>&fee=<category>&asof=<YYYY-MM-DD>#peer-sets`
 * (`hamiltonPeerSetHref`, #1779). Settings pre-fills the peer-group form with it; nothing is saved
 * until the user saves the form through the existing `createPeerSet` action.
 *
 * Every parameter is checked on its own and dropped when it is malformed or unknown, so a bad link
 * never blocks the page. No database access here: unknown institution ids are dropped by
 * `resolvePeerSetPrefill` with the lookup the page passes in (`getPeerInstitutionNames`).
 */

/** The most institutions a saved peer group holds (the save action and the form enforce it). */
export const MAX_PEER_SET_INSTITUTIONS = 50;
/** The longest peer-group name the save action accepts. */
export const MAX_PEER_SET_NAME_LENGTH = 100;

/** institution_sources.id is a Postgres integer; larger ids cannot exist and would break the lookup's ::int[] cast. */
const MAX_INSTITUTION_ID = 2_147_483_647;
/** The longest `peers` value a full set can produce: 50 ten-digit ids and their commas. */
const MAX_PEERS_PARAM_LENGTH = MAX_PEER_SET_INSTITUTIONS * 11;
/**
 * Characters a peer-set label is written with ("The 25 banks closest in assets", "Banks with
 * $300M to $1B in assets", "Credit unions with branches in the Tampa-St. Petersburg-Clearwater, FL
 * metro"). Anything else (markup, quotes, control characters) drops the name.
 */
const NAME_PATTERN = /^[\p{L}\p{N} .,'’&()/+$%:-]+$/u;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type PeerSetPrefillParams = {
  peers?: string | string[];
  name?: string | string[];
  fee?: string | string[];
  asof?: string | string[];
};

export type ParsedPeerSetPrefill = {
  peerIds: number[];
  name: string | null;
  fee: string | null;
  asOf: string | null;
};

export type PeerSetPrefill = {
  peers: { id: number; name: string }[];
  name: string | null;
  fee: { key: string; label: string } | null;
  asOf: string | null;
};

/** A repeated parameter (`?peers=1&peers=2`) is not something the link builder writes, so it is ignored. */
function single(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function parsePeerIds(raw: string | null): number[] {
  if (!raw || raw.length > MAX_PEERS_PARAM_LENGTH) return [];
  const ids: number[] = [];
  for (const token of raw.split(",")) {
    const trimmed = token.trim();
    if (!/^[1-9]\d{0,9}$/.test(trimmed)) continue;
    const id = Number(trimmed);
    if (id > MAX_INSTITUTION_ID || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= MAX_PEER_SET_INSTITUTIONS) break;
  }
  return ids;
}

function parseName(raw: string | null): string | null {
  if (raw === null || raw.length > MAX_PEER_SET_NAME_LENGTH * 2) return null;
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name || name.length > MAX_PEER_SET_NAME_LENGTH || !NAME_PATTERN.test(name)) return null;
  return name;
}

function parseFee(raw: string | null): string | null {
  if (!raw || raw.length > 64 || !/^[a-z0-9_]+$/.test(raw)) return null;
  return Object.hasOwn(DISPLAY_NAMES, raw) ? raw : null;
}

/** A real calendar date in YYYY-MM-DD, from 2000 on and no later than tomorrow (UTC). */
function parseAsOf(raw: string | null, now: Date): string | null {
  const match = raw ? DATE_PATTERN.exec(raw) : null;
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (y < 2000 || date.getTime() > now.getTime() + 86_400_000) return null;
  return raw;
}

/** The link's parameters, each checked on its own. Pure: no lookup. */
export function parsePeerSetPrefillParams(params: PeerSetPrefillParams, now: Date = new Date()): ParsedPeerSetPrefill {
  return {
    peerIds: parsePeerIds(single(params.peers)),
    name: parseName(single(params.name)),
    fee: parseFee(single(params.fee)),
    asOf: parseAsOf(single(params.asof), now),
  };
}

/** True when the link carried anything worth keeping through a sign-in redirect. */
export function hasPeerSetPrefill(parsed: ParsedPeerSetPrefill): boolean {
  return parsed.peerIds.length > 0;
}

/** The checked parameters written back in the link builder's format, for a sign-in return path. */
export function peerSetPrefillSearch(parsed: ParsedPeerSetPrefill): URLSearchParams {
  const search = new URLSearchParams();
  if (parsed.peerIds.length > 0) search.set("peers", parsed.peerIds.join(","));
  if (parsed.name) search.set("name", parsed.name);
  if (parsed.fee) search.set("fee", parsed.fee);
  if (parsed.asOf) search.set("asof", parsed.asOf);
  return search;
}

/**
 * The form's pre-fill: only peers found in institution_sources, in the link's order. Null when no
 * peer is known, since a hand-picked group needs at least one institution to save.
 */
export async function resolvePeerSetPrefill(
  parsed: ParsedPeerSetPrefill,
  lookupNames: (ids: number[]) => Promise<Map<number, string>>,
): Promise<PeerSetPrefill | null> {
  if (parsed.peerIds.length === 0) return null;
  let names: Map<number, string>;
  try {
    names = await lookupNames(parsed.peerIds);
  } catch {
    return null;
  }
  const peers = parsed.peerIds.flatMap((id) => {
    const name = names.get(id);
    return name ? [{ id, name }] : [];
  });
  if (peers.length === 0) return null;
  return {
    peers,
    name: parsed.name,
    fee: parsed.fee ? { key: parsed.fee, label: DISPLAY_NAMES[parsed.fee] } : null,
    asOf: parsed.asOf,
  };
}

/** "October 17, 2026", fixed to UTC so server and browser render the same day. */
export function formatPrefillDate(asOf: string): string {
  return new Date(`${asOf}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
