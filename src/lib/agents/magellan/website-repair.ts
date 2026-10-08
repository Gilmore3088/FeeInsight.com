/**
 * Repairs a bank's stored website address before discovery searches it. Pure: no
 * network, no database. Fixes only obvious typing mistakes in registry and legacy
 * data ("wwwbank.com", "www.bankcom", "HTTP//Bank.com/ ", "bank.con"); anything it is
 * not sure about is left as it is (an unfamiliar domain ending is flagged, not
 * changed), and an address that still cannot be read is reported as `unparseable`.
 */

export type WebsiteRepairStatus = "ok" | "repaired" | "unparseable" | "empty";

export interface WebsiteRepair {
  status: WebsiteRepairStatus;
  /** The stored value, as given. */
  original: string | null;
  /** The address to search (`ok` or `repaired`); a bare host has no trailing slash. */
  url: string | null;
  /** What was changed, in order (empty when `ok`). */
  changes: string[];
  /** Things left alone but worth counting (an unfamiliar domain ending). */
  warnings: string[];
  /** Why the address could not be read (`unparseable` only). */
  reason?: string;
}

/** Domain endings a US bank or credit union site commonly uses; others are flagged, not refused. */
const COMMON_TLDS = new Set([
  "com", "net", "org", "bank", "us", "coop", "biz", "info", "co", "edu", "gov", "io",
  "credit", "creditunion", "financial", "finance", "money", "fund", "insurance", "mortgage",
  "loans", "community", "online", "site", "app", "website", "group", "pr", "vi", "gu", "as", "mp",
]);

/** Misspelled domain endings with one obvious meaning. */
const TLD_TYPOS: Record<string, string> = {
  con: "com",
  cmo: "com",
  ocm: "com",
  comm: "com",
  coom: "com",
  ccom: "com",
  vom: "com",
  xom: "com",
  cpm: "com",
  nte: "net",
  nett: "net",
  ogr: "org",
  rog: "org",
  orgg: "org",
};

/** A domain with no dot before its ending ("bankcom", "firstbanknet"). */
const GLUED_TLD = /^([a-z0-9-]{2,}?)(com|net|org|coop)$/;
/** The ending split off by a space ("www.bank com"). */
const SPLIT_TLD = /([a-z0-9-])\s+(com|net|org|bank|coop|us)(?=$|[\s/?#])/i;
const WEB_SCHEME = /^(h?t?t?t?p?s?)\s*[:;]?\s*\/\/?/i;

function hostLabelsValid(host: string): boolean {
  const labels = host.split(".");
  return labels.length >= 2 && labels.every((label) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

export function repairWebsiteUrl(value: string | null | undefined): WebsiteRepair {
  const original = value ?? null;
  const changes: string[] = [];
  const warnings: string[] = [];
  const unparseable = (reason: string): WebsiteRepair => ({ status: "unparseable", original, url: null, changes, warnings, reason });
  if (value == null || value.trim() === "") return { status: "empty", original, url: null, changes, warnings };

  let text = value.trim();
  if (text !== value) changes.push("trimmed_whitespace");
  // Spaces inside the address: around dots ("bank . com"), before its ending
  // ("bank com"), then any words after it ("bank.com main office").
  const tightened = text.replace(/\s*\.\s*/g, ".").replace(SPLIT_TLD, "$1.$2");
  if (tightened !== text) {
    changes.push("removed_inner_whitespace");
    text = tightened;
  }
  if (/\s/.test(text)) {
    changes.push("dropped_trailing_words");
    text = text.split(/\s+/)[0];
  }
  // Quotes, brackets and punctuation copied in with the address.
  const unwrapped = text.replace(/^[<("'[]+/, "").replace(/[>)"'\],;.!:]+$/, "");
  if (unwrapped !== text) {
    changes.push("removed_trailing_junk");
    text = unwrapped;
  }

  // Scheme: fix its typos ("http//", "https:/", "htp://"), add https:// when missing.
  const scheme = WEB_SCHEME.exec(text);
  if (scheme && /^h|^t|^p/i.test(scheme[1] ?? "") && /[:/]/.test(scheme[0])) {
    const secure = /s$/i.test(scheme[1] ?? "");
    const fixed = `${secure ? "https" : "http"}://${text.slice(scheme[0].length)}`;
    if (fixed.slice(0, 8).toLowerCase() !== text.slice(0, 8).toLowerCase()) changes.push("fixed_scheme");
    else if (fixed.slice(0, 8) !== text.slice(0, 8)) changes.push("lowercased_scheme");
    text = fixed;
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^:/]+:\d+/.test(text)) {
    return unparseable(`Not a web address (${text.split(":")[0]}:)`);
  } else {
    changes.push("added_scheme");
    text = `https://${text.replace(/^\/+/, "")}`;
  }

  // A scheme stored twice ("https://HTTP://WWW.BANKWITHCHOICE.COM", Choice Financial, 8 Oct 2026).
  const doubled = /^(https?:\/\/)https?:?\/\/+/i.exec(text);
  if (doubled) {
    text = `${doubled[1]}${text.slice(doubled[0].length)}`;
    changes.push("removed_doubled_scheme");
  }

  const rawHost = /^https?:\/\/([^/?#]*)/i.exec(text)?.[1] ?? "";
  if (rawHost.includes("@")) return unparseable("Address carries a user name");
  let host = rawHost.replace(/:\d+$/, "");
  const port = rawHost.slice(host.length);
  const lower = host.toLowerCase();
  if (lower !== host) changes.push("lowercased_host");
  host = lower;
  if (host.includes(",")) {
    host = host.replace(/,/g, ".");
    changes.push("comma_to_dot");
  }
  if (/\.{2,}/.test(host) || host.endsWith(".") || host.startsWith(".")) {
    host = host.replace(/\.{2,}/g, ".").replace(/^\.|\.$/g, "");
    changes.push("removed_extra_dots");
  }
  // "wwwbank.com" -> "www.bank.com" ("www2.bank.com" and "www-bank.com" are left alone).
  let prefix = "";
  let body = host;
  if (host.startsWith("www.")) {
    prefix = "www.";
    body = host.slice(4);
  } else if (/^www[a-z]/.test(host)) {
    prefix = "www.";
    body = host.slice(3);
    changes.push("added_dot_after_www");
  }
  // "www.bankcom" -> "www.bank.com".
  if (!body.includes(".")) {
    const glued = GLUED_TLD.exec(body);
    if (!glued) return unparseable(`Host "${host}" has no domain ending`);
    body = `${glued[1]}.${glued[2]}`;
    changes.push("added_dot_before_tld");
  }
  const labels = body.split(".");
  const tld = labels[labels.length - 1];
  if (TLD_TYPOS[tld]) {
    labels[labels.length - 1] = TLD_TYPOS[tld];
    changes.push(`fixed_tld_${tld}`);
  }
  host = `${prefix}${labels.join(".")}`;

  if (!hostLabelsValid(host)) return unparseable(`Host "${host}" is not a valid domain name`);
  const finalTld = host.split(".").pop() ?? "";
  if (/^\d+$/.test(finalTld)) return unparseable("Address is an IP number, not a bank website");
  if (!COMMON_TLDS.has(finalTld) && finalTld.length !== 2) warnings.push(`unfamiliar_tld_${finalTld}`);

  const rest = text.slice(text.indexOf(rawHost) + rawHost.length);
  let url: URL;
  try {
    url = new URL(`${text.slice(0, text.indexOf("://") + 3).toLowerCase()}${host}${port}${rest}`);
  } catch {
    return unparseable("Address cannot be parsed");
  }
  url.hash = "";
  const out = url.pathname === "/" && !url.search ? `${url.protocol}//${url.host}` : url.toString();
  return { status: changes.length === 0 ? "ok" : "repaired", original, url: out, changes, warnings };
}

/**
 * True when the repair changed what the bank's stored website should be. Adding the
 * scheme or trimming spaces is how discovery has always read a stored address, so those
 * alone are not written back; a fixed host, scheme typo or stray text is.
 */
export function repairIsWorthSaving(repair: WebsiteRepair): boolean {
  if (repair.status !== "repaired") return false;
  return repair.changes.some((change) => change !== "added_scheme" && change !== "trimmed_whitespace");
}
