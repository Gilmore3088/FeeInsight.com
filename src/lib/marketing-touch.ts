/**
 * Tracked-link visits (growth-os BUILD-PLAN 1.10, 1.11). A visit from a link with utm_ tags
 * is recorded once per browser session, with no personal data: only the link's UTM values,
 * the path it landed on and the referring site's host. The same first-touch values ride
 * along on the report request and contact forms so each lead keeps its first tracked source.
 *
 * Pure and safe on both client and server; storage access never throws.
 */

export const MARKETING_TOUCH_ENDPOINT = "/api/track/touch";
/** sessionStorage key holding this session's first tracked touch (JSON). */
export const FIRST_TOUCH_STORAGE_KEY = "fi_first_touch";

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
export type UtmKey = (typeof UTM_KEYS)[number];

export interface MarketingTouch {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  landing_path: string | null;
  referrer_host: string | null;
}

export const MAX_UTM_LENGTH = 100;
export const MAX_LANDING_PATH_LENGTH = 200;
const MAX_HOST_LENGTH = 253;

// Letters, digits and the punctuation real campaign tags use; anything else is dropped.
const UTM_PATTERN = /^[\p{L}\p{N} _.+~:/@%-]+$/u;
const PATH_PATTERN = /^\/(?!\/)[A-Za-z0-9\-._~/%!$&'()*+,;=:@]*$/;
const HOST_PATTERN = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/** One UTM value, trimmed and checked; null when missing, too long or carrying odd characters. */
export function parseUtmValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_UTM_LENGTH) return null;
  return UTM_PATTERN.test(trimmed) ? trimmed : null;
}

/** The path a visit landed on, without its query or hash; null when not a same-site path. */
export function parseLandingPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim().split(/[?#]/, 1)[0] ?? "";
  if (path.length === 0 || path.length > MAX_LANDING_PATH_LENGTH) return null;
  return PATH_PATTERN.test(path) ? path : null;
}

/** A referring site's host name, lowercased; null for anything that is not a plain host. */
export function parseReferrerHost(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  if (host.length === 0 || host.length > MAX_HOST_LENGTH) return null;
  return HOST_PATTERN.test(host) ? host : null;
}

/** True when the touch names where it came from (source, medium or campaign). */
export function hasTrackedSource(touch: MarketingTouch): boolean {
  return Boolean(touch.utm_source || touch.utm_medium || touch.utm_campaign);
}

/**
 * A touch from untrusted input (a request body or sessionStorage). Every field is checked on
 * its own; null when the input names no tracked source at all.
 */
export function parseMarketingTouch(input: unknown): MarketingTouch | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const touch: MarketingTouch = {
    utm_source: parseUtmValue(raw.utm_source),
    utm_medium: parseUtmValue(raw.utm_medium),
    utm_campaign: parseUtmValue(raw.utm_campaign),
    utm_content: parseUtmValue(raw.utm_content),
    utm_term: parseUtmValue(raw.utm_term),
    landing_path: parseLandingPath(raw.landing_path),
    referrer_host: parseReferrerHost(raw.referrer_host),
  };
  return hasTrackedSource(touch) ? touch : null;
}

/**
 * The touch a page URL carries, or null when it has no utm_ values. The referrer host is
 * kept only when it is another site (an internal click says nothing about the source).
 */
export function touchFromLocation(href: string, referrer: string): MarketingTouch | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  let referrerHost: string | null = null;
  try {
    const ref = referrer ? new URL(referrer) : null;
    if (ref && ref.host !== url.host) referrerHost = ref.hostname;
  } catch {
    referrerHost = null;
  }
  const raw: Record<string, unknown> = { landing_path: url.pathname, referrer_host: referrerHost };
  for (const key of UTM_KEYS) raw[key] = url.searchParams.get(key);
  return parseMarketingTouch(raw);
}

function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** This session's first tracked touch, or null (none yet, no storage, or bad data). */
export function readFirstTouch(): MarketingTouch | null {
  try {
    const stored = sessionStore()?.getItem(FIRST_TOUCH_STORAGE_KEY);
    return stored ? parseMarketingTouch(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
}

/** Saves the session's first touch. Returns false when storage is unavailable. */
export function saveFirstTouch(touch: MarketingTouch): boolean {
  try {
    const store = sessionStore();
    if (!store) return false;
    store.setItem(FIRST_TOUCH_STORAGE_KEY, JSON.stringify(touch));
    return true;
  } catch {
    return false;
  }
}
