import { parseDocument } from "htmlparser2";

import { CELL_SEPARATOR, extractHtmlDomText } from "./html-dom";

/**
 * `read.js_fallback`: free routes for pages built by JavaScript (pass 2).
 *
 * A page whose HTML holds no readable text is usually an app shell; the fee table is
 * still somewhere the server sent or links to. In order, cheapest first:
 *   1. embedded data in the HTML itself: `__NEXT_DATA__`, `application/json` and
 *      `ld+json` scripts, Next.js flight data (`self.__next_f.push`), and inline
 *      `window.X = {...}` state. Objects of plain values become one " | " row each;
 *      strings holding HTML are read through the DOM reader.
 *   2. links on the page to a PDF or print version of the schedule.
 *   3. the same URL with common static variants (`?print=1`, `/print`, `?output=amp`).
 * No headless browser: none is configured, and pages with no free route are handed to
 * Magellan's paid finder instead.
 */

export const ROSETTA_JS_FALLBACK_VERSION = 1;
export const JS_FALLBACK_STRATEGY = "read.js_fallback";
/** Alternate URLs fetched per page, at most. */
export const JS_FALLBACK_MAX_FETCHES = 4;

const MAX_EMBEDDED_STRINGS = 20_000;
const FEE_KEY = /(fee|amount|price|charge|cost)/i;
const SHELL_MARKERS = [
  /id=["']?(__next|root|app|___gatsby|svelte|q-app)["'\s>]/i,
  /__NEXT_DATA__|__NUXT__|self\.__next_f|window\.__INITIAL_STATE__|ng-version=|data-reactroot|data-server-rendered/i,
  /<noscript[^>]*>[^<]*(enable|turn on|requires?)\s+javascript/i,
];

/** A page whose readable text is thin and whose HTML is an app shell. */
export function looksLikeJsShell(html: string, text: string): boolean {
  if (text.trim().length === 0) return true;
  if (text.length > 1500) return false;
  return SHELL_MARKERS.some((marker) => marker.test(html));
}

type DomNode = ReturnType<typeof parseDocument>["children"][number];
interface DomElement {
  name: string;
  attribs: Record<string, string>;
  children: DomNode[];
}

function isElement(node: DomNode): node is DomNode & DomElement {
  return "name" in node && "children" in node;
}

function nodeText(node: DomNode): string {
  if ("data" in node && typeof node.data === "string") return node.data;
  if (isElement(node)) return node.children.map(nodeText).join("");
  return "";
}

function elements(nodes: DomNode[], out: DomElement[] = []): DomElement[] {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    out.push(node);
    elements(node.children, out);
  }
  return out;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** Lines from a JSON value: a row per object of plain values, HTML strings read as HTML. */
function jsonLines(value: unknown, lines: string[], budget: { left: number }, key = ""): void {
  if (budget.left <= 0 || value == null) return;
  if (typeof value === "string") {
    budget.left -= 1;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (/<(table|tr|td|p|div|li|br|h\d)\b/i.test(trimmed)) {
      lines.push(extractHtmlDomText(trimmed).text);
    } else if (/[a-z]/i.test(trimmed) && trimmed.length < 5000 && !/^(https?:|\/)[^\s]*$/.test(trimmed)) {
      lines.push(trimmed);
    }
    return;
  }
  if (typeof value === "number") {
    if (FEE_KEY.test(key) && Number.isFinite(value)) lines.push(money(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) jsonLines(item, lines, budget, key);
    return;
  }
  if (typeof value !== "object") return;
  const entries = Object.entries(value as Record<string, unknown>);
  const plain = entries.filter(([, inner]) => typeof inner === "string" || typeof inner === "number");
  const nested = entries.filter(([, inner]) => inner && typeof inner === "object");
  // { name: "Overdraft fee", amount: 35 } -> "Overdraft fee | $35.00"
  const cells = plain
    .map(([innerKey, inner]) =>
      typeof inner === "number" ? (FEE_KEY.test(innerKey) && Number.isFinite(inner) ? money(inner) : "") : String(inner).trim(),
    )
    .filter((cell) => cell.length > 0 && cell.length < 300 && !/^(https?:|\/)[^\s]*$/.test(cell) && !/^[\w-]{20,}$/.test(cell));
  if (cells.length >= 2 && cells.some((cell) => /[a-z]/i.test(cell)) && cells.some((cell) => /\$\s?\d/.test(cell))) {
    budget.left -= 1;
    lines.push(cells.join(CELL_SEPARATOR));
  } else {
    for (const [innerKey, inner] of plain) jsonLines(inner, lines, budget, innerKey);
  }
  for (const [innerKey, inner] of nested) jsonLines(inner, lines, budget, innerKey);
}

function parseJsonLoose(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch {
    return undefined;
  }
}

/** The JSON object assigned in `window.X = {...};` style inline scripts. */
function assignedObjects(script: string): unknown[] {
  const found: unknown[] = [];
  const pattern = /(?:window|self|globalThis)\.[\w$]+\s*=\s*(\{[\s\S]*?\})\s*;?\s*(?=$|\n|(?:window|self|globalThis)\.)/g;
  for (const match of script.matchAll(pattern)) {
    const parsed = parseJsonLoose(match[1]);
    if (parsed !== undefined) found.push(parsed);
  }
  return found;
}

/** Next.js app-router flight chunks: `self.__next_f.push([1,"..."])`. */
function flightStrings(script: string): string[] {
  const found: string[] = [];
  for (const match of script.matchAll(/self\.__next_f\.push\(\[\d+,\s*("(?:[^"\\]|\\.)*")\]\)/g)) {
    const parsed = parseJsonLoose(match[1]);
    if (typeof parsed === "string") found.push(parsed);
  }
  return found;
}

/** Readable text from data the page embeds for its scripts. Empty when there is none. */
export function embeddedDataText(html: string): string {
  const document = parseDocument(html, { decodeEntities: false, lowerCaseTags: true });
  const lines: string[] = [];
  const budget = { left: MAX_EMBEDDED_STRINGS };
  for (const script of elements(document.children).filter((element) => element.name === "script")) {
    const type = (script.attribs.type ?? "").toLowerCase();
    const body = script.children.map(nodeText).join("").trim();
    if (!body) continue;
    if (type.includes("json") || script.attribs.id === "__NEXT_DATA__") {
      jsonLines(parseJsonLoose(body), lines, budget);
      continue;
    }
    if (type && !type.includes("javascript") && type !== "module") continue;
    for (const object of assignedObjects(body)) jsonLines(object, lines, budget);
    for (const chunk of flightStrings(body)) {
      // A flight chunk is either JSON-ish component data or a plain/HTML string.
      const colon = chunk.indexOf(":");
      const payload = colon >= 0 && colon < 8 ? parseJsonLoose(chunk.slice(colon + 1)) : undefined;
      if (payload !== undefined) jsonLines(payload, lines, budget);
      else jsonLines(chunk, lines, budget);
    }
  }
  // Drop repeats (frameworks often embed the same data twice) but keep the order.
  const seen = new Set<string>();
  return lines
    .join("\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => {
      if (!line || seen.has(line)) return false;
      seen.add(line);
      return true;
    })
    .join("\n");
}

const DOCUMENT_WORDS = /(fee|schedule|disclosure|pricing|charges|truth[\s-]in[\s-]savings|account agreement)/i;
const PRINT_WORDS = /\b(print|printable|pdf|download)\b/i;

function resolveUrl(href: string | undefined, base: string): string | null {
  if (!href || /^(javascript|mailto|tel):/i.test(href.trim())) return null;
  try {
    const url = new URL(href.trim(), base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** Links the page itself offers to a PDF or print version of the schedule. */
export function alternateDocumentUrls(html: string, pageUrl: string): string[] {
  const document = parseDocument(html, { decodeEntities: true, lowerCaseTags: true });
  const found: string[] = [];
  const add = (url: string | null) => {
    if (url && url !== pageUrl && !found.includes(url)) found.push(url);
  };
  for (const element of elements(document.children)) {
    if (element.name === "link") {
      const rel = (element.attribs.rel ?? "").toLowerCase();
      const type = (element.attribs.type ?? "").toLowerCase();
      if (rel.includes("amphtml") || (rel.includes("alternate") && (type.includes("pdf") || type.includes("html")))) {
        add(resolveUrl(element.attribs.href, pageUrl));
      }
    } else if (element.name === "a") {
      const href = element.attribs.href ?? "";
      const label = `${element.children.map(nodeText).join("")} ${element.attribs.title ?? ""} ${element.attribs["aria-label"] ?? ""}`;
      const isPdf = /\.pdf(?:$|[?#])/i.test(href);
      if ((isPdf && (DOCUMENT_WORDS.test(label) || DOCUMENT_WORDS.test(href))) || (PRINT_WORDS.test(label) && DOCUMENT_WORDS.test(`${label} ${href}`))) {
        add(resolveUrl(href, pageUrl));
      }
    }
  }
  // PDFs first: they are the most likely to hold the full schedule.
  return found.sort((a, b) => Number(/\.pdf(?:$|[?#])/i.test(b)) - Number(/\.pdf(?:$|[?#])/i.test(a)));
}

/** Common server-rendered variants of the same page. */
export function staticVariantUrls(pageUrl: string): string[] {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return [];
  }
  const variants: string[] = [];
  for (const [key, value] of [["print", "1"], ["output", "amp"]] as const) {
    const variant = new URL(url);
    variant.searchParams.set(key, value);
    variants.push(variant.toString());
  }
  const printPath = new URL(url);
  printPath.pathname = `${url.pathname.replace(/\/$/, "")}/print`;
  printPath.search = url.search;
  variants.push(printPath.toString());
  return variants.filter((variant) => variant !== pageUrl);
}
