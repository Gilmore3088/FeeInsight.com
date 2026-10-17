import { createHash } from "node:crypto";
import { geoBounds, geoContains } from "d3-geo";
import { inflateSync, strFromU8 } from "fflate";
import { countyFeatures } from "@/lib/geo/counties";
import { STATE_NAMES } from "@/lib/us-states";
import { STATE_FROM_FIPS, type AreaFetch, type AreaStat } from "./economy";
import { registryFetch, registryFetchJson, type RegistryFetchOptions } from "./http";
import { normalizeListedName } from "./payment-networks";

/**
 * AllThePlaces (https://www.alltheplaces.xyz): store-locator scrapers ("spiders") whose weekly
 * run output is published as one GeoJSON file per spider inside a zip. Licensed CC0 1.0. Pure
 * transport and parsing: no DB access.
 *
 * The run index (`runs/latest.json`) names the run and its `output.zip`. The zip holds every
 * spider worldwide (well over a gigabyte), so it is never downloaded whole: the loader reads the
 * zip's central directory with HTTP Range requests, picks the bank, credit-union and ATM spiders
 * of one shard, and fetches only those entries' bytes. A server that ignores Range (answers 200
 * instead of 206) stops the step with a named reason instead of a full download.
 *
 * The site is blocked from the sandbox this was written in. The run-index field names, the
 * `output/<spider>.geojson` entry layout and the OSM-style property names (amenity, brand,
 * brand:wikidata, addr:*) are from the project's documentation as remembered; every one is
 * checked at run time and a missing one is reported by name, never filled.
 */

export const ATP_RUN_INDEX_URL = "https://data.alltheplaces.xyz/runs/latest.json";
export const ATP_LICENSE = "CC0-1.0";
export const ATP_ATTRIBUTION = "AllThePlaces (alltheplaces.xyz), CC0 1.0";
/** Extra spider names to read, comma separated, on top of the name rule and the list below. */
export const ATP_SPIDERS_ENV = "ALLTHEPLACES_SPIDERS";

/** Run-index fields the loader reads. */
export const ATP_RUN_FIELDS = ["run_id", "output_url"] as const;
/** Feature properties the loader reads; one absent from every feature of a spider is reported. */
export const ATP_PROPERTY_FIELDS = ["amenity", "brand", "brand:wikidata", "operator", "name", "addr:city", "addr:state", "addr:postcode", "addr:country"] as const;

/** Spiders are read in shards by the first character of their name, then the area counts. */
export const ATP_SHARDS = [..."abcdefghijklmnopqrstuvwxyz", "0"] as const;
export const ATP_AREA_PARTITION = "area-stats";

export function atpPartitions(): string[] {
  return [...ATP_SHARDS.map((s) => `spiders-${s}`), ATP_AREA_PARTITION];
}

export function atpShardOf(partitionKey: string): string | null {
  const m = /^spiders-([a-z0])$/.exec(partitionKey);
  return m ? m[1] : null;
}

export function spiderShard(spider: string): string {
  const first = spider.charAt(0).toLowerCase();
  return /[a-z]/.test(first) ? first : "0";
}

/**
 * Spider names that say bank, credit union or ATM. A bank spider named only after its brand
 * ("pnc_us") does not match; those come from ATP_EXTRA_SPIDERS or ALLTHEPLACES_SPIDERS.
 */
export const ATP_SPIDER_NAME_RULE = /bank|credit_?union|(^|_)(fcu|cu|atm|atms|bancorp|banc|savings)(_|$)/i;

/**
 * Brand-named US bank and ATM spiders, from memory of the ATP repository: unconfirmed. A name
 * absent from the run's zip is reported in the partition detail (`listed_spiders_absent`).
 */
export const ATP_EXTRA_SPIDERS = ["chase_us", "pnc_us", "truist_us", "regions_us", "citizens_us", "huntington_us", "fifth_third_us", "td_us", "citi_us", "allpoint", "moneypass_us"] as const;

export function configuredSpiders(env: Record<string, string | undefined> = process.env): string[] {
  const extra = (env[ATP_SPIDERS_ENV] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return [...new Set([...ATP_EXTRA_SPIDERS, ...extra])];
}

// ---------------------------------------------------------------------------------------------
// Run index

export interface AtpRun {
  runId: string;
  outputUrl: string;
  /** YYYY-MM-DD read from the run id; null when the id does not start with a date. */
  runDate: string | null;
  missingFields: string[];
  raw: Record<string, unknown>;
}

export function parseRunIndex(json: unknown): AtpRun | { missingFields: string[]; runId: null } {
  const obj = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const missingFields = ATP_RUN_FIELDS.filter((f) => typeof obj[f] !== "string" || !(obj[f] as string).trim());
  if (missingFields.length > 0) return { missingFields, runId: null };
  const runId = String(obj.run_id).trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(runId);
  return { runId, outputUrl: String(obj.output_url).trim(), runDate: m ? m[1] : null, missingFields: [], raw: obj };
}

export async function fetchRunIndex(options: RegistryFetchOptions = {}) {
  return parseRunIndex(await registryFetchJson<unknown>(ATP_RUN_INDEX_URL, options));
}

// ---------------------------------------------------------------------------------------------
// Zip over HTTP Range

export class RangeNotSupportedError extends Error {
  constructor(readonly url: string, readonly status: number) {
    super(`${url} answered ${status} to a Range request; the zip is not downloaded whole`);
    this.name = "RangeNotSupportedError";
  }
}

export interface RangeRead {
  bytes: Uint8Array;
  /** Whole file size from Content-Range; null when the header is absent. */
  total: number | null;
}

/** One byte range (`bytes=a-b`, or `bytes=-n` for the last n bytes). Only a 206 is accepted. */
export async function fetchRange(url: string, range: string, options: RegistryFetchOptions = {}): Promise<RangeRead> {
  const response = await registryFetch(url, { ...options, headers: { ...options.headers, Range: `bytes=${range}` } });
  if (response.status !== 206) {
    await response.body?.cancel().catch(() => undefined);
    throw new RangeNotSupportedError(url, response.status);
  }
  const m = /\/(\d+)\s*$/.exec(response.headers.get("content-range") ?? "");
  return { bytes: new Uint8Array(await response.arrayBuffer()), total: m ? Number(m[1]) : null };
}

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)) + b[at + 3] * 0x1000000;
const u64 = (b: Uint8Array, at: number) => u32(b, at) + u32(b, at + 4) * 0x100000000;

export interface ZipDirectoryLocation {
  entries: number;
  size: number;
  offset: number;
  zip64: boolean;
  /** Absolute offset of the zip64 end record to fetch next, when the tail only holds its locator. */
  zip64RecordOffset: number | null;
}

/** Finds the end-of-central-directory record in the zip's tail; `tailStart` is its absolute offset. */
export function locateCentralDirectory(tail: Uint8Array): ZipDirectoryLocation | null {
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (u32(tail, i) !== 0x06054b50) continue;
    const entries = u16(tail, i + 10);
    const size = u32(tail, i + 12);
    const offset = u32(tail, i + 16);
    if (entries !== 0xffff && size !== 0xffffffff && offset !== 0xffffffff) return { entries, size, offset, zip64: false, zip64RecordOffset: null };
    const loc = i - 20;
    if (loc < 0 || u32(tail, loc) !== 0x07064b50) return null;
    return { entries, size, offset, zip64: true, zip64RecordOffset: u64(tail, loc + 8) };
  }
  return null;
}

/** Reads a zip64 end-of-central-directory record (56 bytes). */
export function readZip64Record(record: Uint8Array): ZipDirectoryLocation | null {
  if (record.length < 56 || u32(record, 0) !== 0x06064b50) return null;
  return { entries: u64(record, 32), size: u64(record, 40), offset: u64(record, 48), zip64: true, zip64RecordOffset: null };
}

export function parseCentralDirectory(dir: Uint8Array): ZipEntry[] {
  const out: ZipEntry[] = [];
  const decoder = new TextDecoder();
  let at = 0;
  while (at + 46 <= dir.length && u32(dir, at) === 0x02014b50) {
    const method = u16(dir, at + 10);
    let compressedSize = u32(dir, at + 20);
    let uncompressedSize = u32(dir, at + 24);
    const nameLen = u16(dir, at + 28);
    const extraLen = u16(dir, at + 30);
    const commentLen = u16(dir, at + 32);
    let localHeaderOffset = u32(dir, at + 42);
    const name = decoder.decode(dir.subarray(at + 46, at + 46 + nameLen));
    // zip64 extra field (0x0001) carries, in order, whichever sizes/offset were 0xFFFFFFFF.
    let e = at + 46 + nameLen;
    const end = e + extraLen;
    while (e + 4 <= end) {
      const id = u16(dir, e);
      const len = u16(dir, e + 2);
      if (id === 0x0001) {
        let p = e + 4;
        if (uncompressedSize === 0xffffffff) { uncompressedSize = u64(dir, p); p += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = u64(dir, p); p += 8; }
        if (localHeaderOffset === 0xffffffff) localHeaderOffset = u64(dir, p);
      }
      e += 4 + len;
    }
    out.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    at = end + commentLen;
  }
  return out;
}

/** Spider name of an `output/<spider>.geojson` entry; null for anything else. */
export function spiderOfEntry(name: string): string | null {
  const m = /^(?:.*\/)?([^/]+)\.geojson$/i.exec(name);
  return m ? m[1] : null;
}

/** Reads the central directory of a remote zip with two or three Range requests. */
export async function readRemoteZipDirectory(url: string, options: RegistryFetchOptions = {}): Promise<{ entries: ZipEntry[]; total: number | null }> {
  const tail = await fetchRange(url, "-65557", options);
  let loc = locateCentralDirectory(tail.bytes);
  if (!loc) throw new Error(`No zip end record in the last ${tail.bytes.length} bytes of ${url}`);
  if (loc.zip64RecordOffset !== null) {
    const rec = await fetchRange(url, `${loc.zip64RecordOffset}-${loc.zip64RecordOffset + 55}`, options);
    loc = readZip64Record(rec.bytes);
    if (!loc) throw new Error(`Unreadable zip64 end record in ${url}`);
  }
  const dir = await fetchRange(url, `${loc.offset}-${loc.offset + loc.size - 1}`, options);
  return { entries: parseCentralDirectory(dir.bytes), total: tail.total };
}

/** Extracts one entry's bytes from a local-header-plus-data slice. */
export function inflateLocalEntry(slice: Uint8Array, entry: ZipEntry): Uint8Array | { needBytes: number } {
  if (u32(slice, 0) !== 0x04034b50) throw new Error(`No local file header for ${entry.name}`);
  const start = 30 + u16(slice, 26) + u16(slice, 28);
  if (slice.length < start + entry.compressedSize) return { needBytes: start + entry.compressedSize };
  const data = slice.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateSync(data);
  throw new Error(`Zip method ${entry.method} for ${entry.name} is not read`);
}

/** Largest spider file read; a bigger one is skipped and named. */
export const ATP_MAX_ENTRY_BYTES = 250 * 1024 * 1024;

export async function fetchZipEntryText(url: string, entry: ZipEntry, options: RegistryFetchOptions = {}): Promise<string> {
  const slack = 30 + entry.name.length + 1024;
  let slice = await fetchRange(url, `${entry.localHeaderOffset}-${entry.localHeaderOffset + slack + entry.compressedSize - 1}`, options);
  let out = inflateLocalEntry(slice.bytes, entry);
  if (!(out instanceof Uint8Array)) {
    slice = await fetchRange(url, `${entry.localHeaderOffset}-${entry.localHeaderOffset + out.needBytes - 1}`, options);
    out = inflateLocalEntry(slice.bytes, entry);
    if (!(out instanceof Uint8Array)) throw new Error(`Short read for ${entry.name}`);
  }
  return strFromU8(out);
}

export interface SpiderSelection {
  /** Spiders in this shard to read, sorted. */
  spiders: Array<{ spider: string; entry: ZipEntry; reason: "name_rule" | "listed" }>;
  /** Configured spiders of this shard that the run does not carry. */
  listedAbsent: string[];
  /** Spider files over ATP_MAX_ENTRY_BYTES, not read. */
  tooLarge: string[];
}

export function selectSpiders(entries: ZipEntry[], shard: string, listed: string[]): SpiderSelection {
  const byName = new Map<string, ZipEntry>();
  for (const e of entries) {
    const s = spiderOfEntry(e.name);
    if (s && spiderShard(s) === shard) byName.set(s, e);
  }
  const listedHere = listed.filter((s) => spiderShard(s) === shard);
  const spiders: SpiderSelection["spiders"] = [];
  const tooLarge: string[] = [];
  for (const [spider, entry] of [...byName.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const reason = listedHere.includes(spider) ? "listed" : ATP_SPIDER_NAME_RULE.test(spider) ? "name_rule" : null;
    if (!reason) continue;
    if (entry.uncompressedSize > ATP_MAX_ENTRY_BYTES) tooLarge.push(spider);
    else spiders.push({ spider, entry, reason });
  }
  return { spiders, listedAbsent: listedHere.filter((s) => !byName.has(s)), tooLarge };
}

// ---------------------------------------------------------------------------------------------
// Features

export type AtpKind = "branch" | "atm";

export interface AtpLocation {
  spider: string;
  /** The feature's own id, else `ref:<ref>`, else a hash of its name, address and point. */
  featureKey: string;
  keyBasis: "id" | "ref" | "hash";
  kind: AtpKind;
  name: string | null;
  brand: string | null;
  brandWikidata: string | null;
  operator: string | null;
  operatorWikidata: string | null;
  address: string | null;
  city: string | null;
  /** Two-letter postal code, from addr:state as a code or an exact state name; else null. */
  state: string | null;
  /** Five digits from addr:postcode; null when it is not a US ZIP. */
  zip: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
  ref: string | null;
  sourceUri: string | null;
  raw: Record<string, unknown>;
}

export interface SpiderRead {
  spider: string;
  features: number;
  locations: AtpLocation[];
  /** Features left out, by reason (other_category:<amenity>, non_us:<country>, ...). */
  skipped: Record<string, number>;
  /** ATP_PROPERTY_FIELDS that no feature of this spider carried. */
  missingFields: string[];
  /** Kept locations whose addr:state was present but not a US state code or name. */
  unreadableState: number;
  /** The file was not a FeatureCollection with a features array. */
  invalid: boolean;
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out === "" ? null : out;
}

const STATE_BY_NAME = new Map(Object.entries(STATE_NAMES).map(([code, name]) => [name.toUpperCase(), code]));

export function stateCode(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (STATE_NAMES[upper]) return upper;
  return STATE_BY_NAME.get(upper) ?? null;
}

export function zip5(value: unknown): string | null {
  const m = /^(\d{5})(?:-\d{4})?$/.exec(str(value) ?? "");
  return m ? m[1] : null;
}

function bump(counts: Record<string, number>, key: string) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function addressOf(p: Record<string, unknown>): string | null {
  const street = str(p["addr:street_address"]);
  if (street) return street;
  const road = str(p["addr:street"]);
  if (road) return [str(p["addr:housenumber"]), road].filter(Boolean).join(" ");
  return str(p["addr:full"]);
}

export function parseSpiderGeoJson(spider: string, text: string): SpiderRead {
  const read: SpiderRead = { spider, features: 0, locations: [], skipped: {}, missingFields: [], unreadableState: 0, invalid: false };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ...read, invalid: true };
  }
  const features = json && typeof json === "object" ? (json as { features?: unknown }).features : undefined;
  if (!Array.isArray(features)) return { ...read, invalid: true };
  read.features = features.length;
  const seenFields = new Set<string>();
  const seenKeys = new Set<string>();
  for (const f of features as Array<Record<string, unknown>>) {
    const p = f && typeof f.properties === "object" && f.properties ? (f.properties as Record<string, unknown>) : null;
    if (!p) {
      bump(read.skipped, "no_properties");
      continue;
    }
    for (const field of ATP_PROPERTY_FIELDS) if (str(p[field]) !== null) seenFields.add(field);
    const amenity = str(p.amenity)?.toLowerCase() ?? null;
    const kind: AtpKind | null = amenity === "bank" ? "branch" : amenity === "atm" ? "atm" : null;
    if (!kind) {
      bump(read.skipped, `other_category:${amenity ?? str(p.office) ?? str(p.shop) ?? "none"}`);
      continue;
    }
    const country = str(p["addr:country"])?.toUpperCase() ?? null;
    const rawState = str(p["addr:state"]);
    const state = stateCode(rawState);
    if (country !== null && country !== "US") {
      bump(read.skipped, `non_us:${country}`);
      continue;
    }
    if (country === null && state === null) {
      bump(read.skipped, "country_unknown");
      continue;
    }
    if (rawState !== null && state === null) read.unreadableState += 1;
    const geometry = f.geometry as { type?: unknown; coordinates?: unknown } | null | undefined;
    const coords = geometry?.type === "Point" && Array.isArray(geometry.coordinates) ? (geometry.coordinates as unknown[]) : null;
    const lon = coords && typeof coords[0] === "number" && Math.abs(coords[0]) <= 180 ? coords[0] : null;
    const lat = coords && typeof coords[1] === "number" && Math.abs(coords[1]) <= 90 ? coords[1] : null;
    const id = str(f.id);
    const ref = str(p.ref);
    const name = str(p.name);
    const address = addressOf(p);
    const featureKey = id ?? (ref ? `ref:${ref}` : `hash:${createHash("sha1").update(JSON.stringify([spider, kind, name, address, lat, lon])).digest("hex")}`);
    if (seenKeys.has(featureKey)) {
      bump(read.skipped, "duplicate_key");
      continue;
    }
    seenKeys.add(featureKey);
    read.locations.push({
      spider,
      featureKey,
      keyBasis: id ? "id" : ref ? "ref" : "hash",
      kind,
      name,
      brand: str(p.brand),
      brandWikidata: str(p["brand:wikidata"]),
      operator: str(p.operator),
      operatorWikidata: str(p["operator:wikidata"]),
      address,
      city: str(p["addr:city"]),
      state,
      zip: zip5(p["addr:postcode"]),
      country,
      lat: lat === null || lon === null ? null : lat,
      lon: lat === null || lon === null ? null : lon,
      ref,
      sourceUri: str(p["@source_uri"]) ?? str(p.website),
      raw: p,
    });
  }
  read.missingFields = read.features > 0 ? ATP_PROPERTY_FIELDS.filter((f) => !seenFields.has(f)) : [];
  return read;
}

// ---------------------------------------------------------------------------------------------
// County from point (Census cartographic outlines, us-atlas counties-10m)

let countyIndex: Array<{ fips: string; box: [[number, number], [number, number]]; feature: ReturnType<typeof countyFeatures>[number] }> | null = null;

/**
 * Five-digit county FIPS whose outline holds the point, or null. The 1:10m outlines are
 * simplified, so a location within a few hundred metres of a county line can land next door.
 */
export function countyForPoint(lon: number, lat: number): string | null {
  countyIndex ??= countyFeatures().map((feature) => ({ fips: feature.id, box: geoBounds(feature) as [[number, number], [number, number]], feature }));
  for (const c of countyIndex) {
    const [[w, s], [e, n]] = c.box;
    if (lat < s || lat > n) continue;
    // geoBounds wraps west > east for a shape crossing the antimeridian (Aleutians).
    const inLon = w <= e ? lon >= w && lon <= e : lon >= w || lon <= e;
    if (!inLon) continue;
    if (geoContains(c.feature, [lon, lat])) return c.fips;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Matching to institutions: brand wikidata through the reviewed mapping, or exact name + state

export interface AtpUniverseInstitution {
  id: number;
  name: string;
  state: string | null;
}

export type AtpMatchMethod = "brand_wikidata" | "operator_wikidata" | "name_state";

export interface AtpMatch {
  institutionId: number | null;
  method: AtpMatchMethod | null;
  /** brand or operator: the field an exact name match was made on. */
  field: "brand" | "operator" | null;
  unmatchedReason: "no_match" | "ambiguous" | null;
}

/**
 * `wikidataMap` is the reviewed brand_wikidata_institutions table (QID -> institution id). A
 * name match needs the brand or operator name, normalized, to equal exactly one tracked
 * institution's name in the location's own state; nothing else is tried, and a name shared by
 * two institutions in the state is left unmatched as ambiguous.
 */
export function createAtpMatcher(universe: AtpUniverseInstitution[], wikidataMap: Map<string, number>) {
  const byNameState = new Map<string, Set<number>>();
  for (const inst of universe) {
    const name = normalizeListedName(inst.name);
    if (!name || !inst.state) continue;
    const key = `${name}|${inst.state.toUpperCase()}`;
    if (!byNameState.has(key)) byNameState.set(key, new Set());
    byNameState.get(key)!.add(inst.id);
  }
  return (loc: AtpLocation): AtpMatch => {
    const brandHit = loc.brandWikidata ? wikidataMap.get(loc.brandWikidata.toUpperCase()) : undefined;
    if (brandHit !== undefined) return { institutionId: brandHit, method: "brand_wikidata", field: null, unmatchedReason: null };
    const opHit = loc.operatorWikidata ? wikidataMap.get(loc.operatorWikidata.toUpperCase()) : undefined;
    if (opHit !== undefined) return { institutionId: opHit, method: "operator_wikidata", field: null, unmatchedReason: null };
    let ambiguous = false;
    if (loc.state) {
      for (const field of ["brand", "operator"] as const) {
        const value = loc[field];
        const name = value ? normalizeListedName(value) : "";
        if (!name) continue;
        const ids = byNameState.get(`${name}|${loc.state}`);
        if (!ids) continue;
        if (ids.size === 1) return { institutionId: [...ids][0], method: "name_state", field, unmatchedReason: null };
        ambiguous = true;
      }
    }
    return { institutionId: null, method: null, field: null, unmatchedReason: ambiguous ? "ambiguous" : "no_match" };
  };
}

// ---------------------------------------------------------------------------------------------
// Checks and area counts

export interface AtpShardChecks {
  spiders_read: number;
  features: number;
  locations: number;
  branches: number;
  atms: number;
  without_coordinates: number;
  without_county: number;
  /** addr:state names a different state from the county the point falls in. */
  state_county_disagree: number;
  unreadable_state: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
  matched_by_method: Record<string, number>;
  skipped: Record<string, number>;
  invalid_files: string[];
  missing_fields_by_spider: Record<string, string[]>;
}

export function checkAtpShard(reads: SpiderRead[], counties: Array<string | null>, matches: AtpMatch[]): AtpShardChecks {
  const locations = reads.flatMap((r) => r.locations);
  const skipped: Record<string, number> = {};
  for (const r of reads) for (const [k, v] of Object.entries(r.skipped)) skipped[k] = (skipped[k] ?? 0) + v;
  const byMethod: Record<string, number> = {};
  for (const m of matches) if (m.method) bump(byMethod, m.method);
  let disagree = 0;
  locations.forEach((l, i) => {
    const c = counties[i];
    if (c && l.state && STATE_FROM_FIPS[c.slice(0, 2)] && STATE_FROM_FIPS[c.slice(0, 2)] !== l.state) disagree += 1;
  });
  return {
    spiders_read: reads.length,
    features: reads.reduce((s, r) => s + r.features, 0),
    locations: locations.length,
    branches: locations.filter((l) => l.kind === "branch").length,
    atms: locations.filter((l) => l.kind === "atm").length,
    without_coordinates: locations.filter((l) => l.lat === null).length,
    without_county: counties.filter((c, i) => c === null && locations[i].lat !== null).length,
    state_county_disagree: disagree,
    unreadable_state: reads.reduce((s, r) => s + r.unreadableState, 0),
    matched: matches.filter((m) => m.institutionId !== null).length,
    unmatched: matches.filter((m) => m.institutionId === null).length,
    ambiguous: matches.filter((m) => m.unmatchedReason === "ambiguous").length,
    matched_by_method: byMethod,
    skipped,
    invalid_files: reads.filter((r) => r.invalid).map((r) => r.spider),
    missing_fields_by_spider: Object.fromEntries(reads.filter((r) => r.missingFields.length > 0).map((r) => [r.spider, r.missingFields])),
  };
}

/** One count row from the current locations table: county (may be null), state (may be null), kind. */
export interface AtpCountRow {
  county_fips: string | null;
  state: string | null;
  kind: AtpKind;
  locations: number;
  linked: number;
  spiders: number;
}

export const ATP_SERIES: Record<AtpKind, string> = { branch: "atp_bank_branch_locations", atm: "atp_atm_locations" };
const ATP_NOTE = "Locations mapped by AllThePlaces spiders; covers the chains it scrapes, not every bank, credit union or ATM";

/**
 * area_statistics rows: mapped branches and ATMs by county (point in county outline), state
 * (the county's state, else addr:state) and nation, for one period (the newest run date read).
 */
export function atpAreaStats(counts: AtpCountRow[], period: string, runIds: string[]): AreaFetch {
  const acc = new Map<string, { stat: Omit<AreaStat, "value" | "raw">; value: number; linked: number }>();
  const add = (geo_type: AreaStat["geo_type"], geo_code: string, state_code: string | null, kind: AtpKind, locations: number, linked: number) => {
    const series_key = ATP_SERIES[kind];
    const key = `${geo_type}:${geo_code}:${series_key}`;
    const cur = acc.get(key) ?? { stat: { geo_type, geo_code, geo_name: null, state_code, period, series_key, unit: "count", note: ATP_NOTE }, value: 0, linked: 0 };
    cur.value += locations;
    cur.linked += linked;
    acc.set(key, cur);
  };
  const skipped: Record<string, number> = {};
  for (const r of counts) {
    const n = Number(r.locations);
    const linked = Number(r.linked);
    add("nation", "US", null, r.kind, n, linked);
    const state = (r.county_fips ? STATE_FROM_FIPS[r.county_fips.slice(0, 2)] : null) ?? r.state;
    if (r.county_fips && state) add("county", r.county_fips, state, r.kind, n, linked);
    else skipped.no_county = (skipped.no_county ?? 0) + n;
    if (state) add("state", state, state, r.kind, n, linked);
    else skipped.no_state = (skipped.no_state ?? 0) + n;
  }
  const rows: AreaStat[] = [...acc.values()].map(({ stat, value, linked }) => ({ ...stat, value, raw: { linked_locations: linked, run_ids: runIds, license: ATP_LICENSE } }));
  return { url: ATP_RUN_INDEX_URL, rows, missingFields: [], skipped, emptyReason: rows.length === 0 ? "No AllThePlaces locations are loaded yet" : null };
}

