/**
 * Edgar's source contract: every public-data source the registry loads describes itself the same
 * way, so matching, roll-ups, health and the hand-off to Hamilton can be shared instead of written
 * per source. A new connection is one entry here plus its parser. James named the agent Edgar on
 * 2026-10-17 (docs/project/DECISIONS.md).
 *
 * Every field is read from the loader's own code (URLs, refresh hours, the tables it writes and
 * the ids it matches on). A fact the code does not state is left out or marked unconfirmed, never
 * guessed.
 */

/** How Edgar reaches the publisher. */
export type EdgarConnection =
  /** A file (CSV, ZIP, XLSX, PDF) downloaded whole. */
  | "bulk-file"
  /** A public API that needs no key. */
  | "rest-api"
  /** An API that needs a key held in an environment variable (`envKey`). */
  | "keyed-api"
  /** Web pages or feeds read one by one (press releases, lists, orders). */
  | "web-pages"
  /** Built from data Edgar already holds, at most with a lookup service (e.g. the Census geocoder). */
  | "derived";

/** How often the publisher puts out new data (not how often Edgar checks). */
export type EdgarCadence = "daily" | "weekly" | "monthly" | "quarterly" | "annual" | "irregular" | "one-time";

/** The level one row describes. */
export type EdgarGrain =
  | "institution"
  | "holding-company"
  | "branch"
  | "tract"
  | "zip"
  | "county"
  | "metro"
  | "state"
  | "fed-district"
  | "court-district"
  | "national"
  | "document";

/** The ids a row carries that tie it to an institution or a place. */
export type EdgarLinkKey =
  | "rssd"
  | "fdic-cert"
  | "ncua-charter"
  | "lei"
  | "cik"
  | "aba-routing"
  | "institution-name"
  | "county-fips"
  | "cbsa"
  | "state"
  | "zip"
  | "tract"
  | "fed-district";

export type EdgarLicenceStatus =
  /** A US federal government work (17 U.S.C. 105) or a publisher's stated public-domain release. */
  | "public-domain"
  /** Published under a named open licence (`licenceName`), which may require attribution. */
  | "open-licence"
  /** Free to read, but the terms for showing it to customers are not yet confirmed. */
  | "terms-unconfirmed"
  /** Not loaded or shown until a person confirms the terms. */
  | "held";

export interface EdgarLicence {
  status: EdgarLicenceStatus;
  /** For open-licence: the licence's name, e.g. "CC0 1.0" or "CC BY 4.0". */
  licenceName?: string;
  /** What a person must still check, or how the source must be cited. */
  note?: string;
}

export interface EdgarSourceContract {
  /** The registry source key (`RegistrySourceDefinition.source`). */
  source: string;
  /** Who publishes the data, as a reader would name them. */
  publisher: string;
  licence: EdgarLicence;
  connection: EdgarConnection;
  /** Environment variable holding the key, for keyed-api sources. */
  envKey?: string;
  cadence: EdgarCadence;
  /** The level(s) the stored rows describe. */
  grain: EdgarGrain[];
  /** Ids used to tie rows to institutions or places; empty when rows stand alone. */
  linkKeys: EdgarLinkKey[];
  /** Tables the loader writes, besides `registry_ingest_partitions`. */
  tables: string[];
}
