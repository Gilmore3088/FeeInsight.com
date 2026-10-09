import { sql } from "@/lib/data-store/connection";
import { crawlerUserAgent } from "@/lib/agents/crawler-identity";
import { robotsAllows, robotsDisallows } from "@/lib/agents/magellan/site-signals";

/**
 * NIELSEN's contact finder: the same walk Magellan makes for fee schedules, aimed at the
 * people instead. For each prospect institution it reads the website's leadership, team,
 * about and contact pages and keeps the email addresses the institution itself publishes,
 * with the name and title printed beside each one when the page shows them.
 *
 * Only published addresses are kept. Nothing is guessed from a name pattern, and nothing is
 * sent: the contacts feed outreach drafts that James reads and sends himself.
 */

type SqlTag = typeof sql;
export type Fetcher = typeof fetch;

/** Institutions read per run. */
export const CONTACTS_DEFAULT_LIMIT = 30;
export const CONTACTS_MAX_LIMIT = 60;
/** An institution is read again once its last check is this old. */
export const CONTACTS_RECHECK_DAYS = 30;
/** Leadership and contact pages read per institution, after the homepage. */
export const CONTACT_PAGES_PER_SITE = 3;
/** The prospect pool: institutions this size, with this many live fees (the GTM plan's bar). */
export const PROSPECT_MIN_ASSETS_K = 100_000;
export const PROSPECT_MAX_ASSETS_K = 5_000_000;
export const PROSPECT_MIN_FEES = 10;

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
/** Stop starting new institutions after this long, so a run ends inside the route's time limit. */
const RUN_BUDGET_MS = 85_000;
const CONCURRENCY = 5;

export type ContactRole = "marketing" | "retail" | "finance" | "executive" | "operations" | "compliance" | "other";
export type ContactKind = "person" | "general";

export interface FoundContact {
  email: string;
  kind: ContactKind;
  name: string | null;
  title: string | null;
  role: ContactRole;
  sourceUrl: string;
  context: string;
}

/** Links worth following, best first: leadership pages, then about, then contact. */
const PAGE_HINTS: Array<{ pattern: RegExp; rank: number }> = [
  { pattern: /leadership|management|executive|officers|our-?team|team|staff|people|directory/i, rank: 0 },
  { pattern: /board|directors|who-?we-?are/i, rank: 1 },
  { pattern: /about/i, rank: 2 },
  { pattern: /contact/i, rank: 3 },
];

/** A role from a title or a mailbox name; the first match wins, so "SVP Marketing" is marketing. */
const ROLE_PATTERNS: Array<{ role: ContactRole; pattern: RegExp }> = [
  { role: "marketing", pattern: /\bmarketing\b|brand|communications|\bcmo\b/i },
  { role: "retail", pattern: /retail|deposit|product|consumer bank/i },
  { role: "finance", pattern: /\bcfo\b|chief financial|finance|treasurer|controller/i },
  { role: "executive", pattern: /\bceo\b|chief executive|president/i },
  { role: "operations", pattern: /\bcoo\b|chief operating|operations/i },
  { role: "compliance", pattern: /compliance|\bbsa\b|risk/i },
];

/** Shared mailboxes rather than a person. */
const GENERAL_MAILBOX =
  /^(info|contact|contactus|customerservice|customer\.?service|service|services|support|help|hello|questions|webmaster|web|mail|online|onlinebanking|ebanking|loans?|lending|mortgages?|cards?|fraud|security|careers|jobs|hr|humanresources|privacy|deposits?|accounting|bsa|compliance|memberservices?|members?|marketing|media|press|news|investor|investors|ir|noreply|no-reply|donotreply)$/i;

/** Mailboxes the pattern above misses: "member_serv", "treasurysupport", "web-executive-dl", committees, the board, card lines. */
const SHARED_MAILBOX_PART = /(?:^|[._-])(?:serv|support|admin|statements?|insurance|dl)(?:$|[._-])|support$|admin$|supervisory|committee|boardof|directors|^members?[._-]|^(?:visa|debit|mastercard|board)$/i;

/** True when an address is a shared mailbox, not one person's. */
export function isSharedMailbox(email: string): boolean {
  const local = email.split("@")[0] ?? "";
  return GENERAL_MAILBOX.test(local) || SHARED_MAILBOX_PART.test(local);
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/g;
const NOT_EMAIL_TLD = /\.(png|jpe?g|gif|svg|webp|css|js)$/i;
const PERSON_NAME =
  /^(?:(?:Mr|Mrs|Ms|Dr)\.?\s+)?[A-Z][a-zA-Z'’-]+(?:\s+[A-Z]\.)?(?:\s+[A-Z][a-zA-Z'’-]+){1,2}(?:,?\s+(?:Jr\.?|Sr\.?|II|III|IV|CPA|CFA|CFP))?$/;

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** The page as lines of text: block tags break lines, scripts and styles are dropped. */
export function pageLines(html: string): string[] {
  const text = decodeEntities(
    html
      .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ")
      // A mail link becomes its address alone: its text ("Email Jane") is neither a name nor a title.
      .replace(/<a\b[^>]*href=["']mailto:([^"'?]+)[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, (_m, address: string) => ` ${safeDecode(address)} `)
      .replace(/<\/?(p|div|li|tr|td|th|h[1-6]|br|section|article|header|footer|ul|ol|dt|dd|figure|figcaption|strong|b|em)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
  return text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The host without "www.", lower case. */
export function siteHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** The label before the public suffix: "firstbank" for firstbank.com and firstbank.bank. */
function brandLabel(host: string): string {
  const parts = host.split(".");
  if (parts.length >= 3 && parts.at(-2)!.length <= 3 && parts.at(-1)!.length === 2) return parts.at(-3)!;
  return parts.at(-2) ?? host;
}

/**
 * True when an address belongs to the institution: the website's own domain or a subdomain of
 * it, or the same name under another ending (a bank at firstbank.com that mails from
 * firstbank.bank). Vendor and personal-mail addresses on the page are left out.
 */
export function belongsToSite(email: string, websiteHost: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  if (domain === websiteHost || domain.endsWith(`.${websiteHost}`)) return true;
  return brandLabel(domain) === brandLabel(websiteHost);
}

/** "Vice President" is a rank, not the president: it is read past before the roles are matched. */
const VICE_PRESIDENT = /\b(?:senior\s+|executive\s+|assistant\s+|first\s+)?vice[\s-]+president\b/gi;
/** A title that names a buyer outright, so a lending word in it doesn't rule it out ("SVP, Chief Retail Officer"). */
const BUYER_TITLE = /\b(?:ceo|cfo|cmo|coo)\b|chief (?:executive|financial|marketing|retail|operating|deposit|experience)|\bmarketing\b|\bretail\b(?! lending)|\bdeposits?\b/i;
/**
 * Titles that sell or service rather than buy a fee study: lenders, mortgage and loan staff,
 * business development, relationship and cash management, wealth and trust, equipment finance,
 * credit risk, branch staff.
 */
const NOT_BUYER_TITLE =
  /loan|lend|mortgage|underwrit|business banker|business banking|business development|business services|business product|relationship manager|cash management|treasury management|commercial|wealth|\btrust\b|investment|vendor finance|equipment finance|credit risk|nmls|branch|teller|collections|\bit\b|information technology/i;

/**
 * Member services and member experience are retail only at a decision maker's rank (PR 652's
 * decision-maker rule): "VP of Member Experience" buys a fee study, a "Member Services Manager" doesn't.
 */
const MEMBER_ROLE = /member (?:experience|services?)/i;
const DECISION_MAKER_RANK = /\b(?:vp|svp|evp|vice[\s-]+president|director|chief|head)\b/i;

/** Business-side desks and junior ranks that don't own retail fee pricing, whatever else the title says. */
const NEVER_BUYER_TITLE = /cash management|treasury management|commercial|\b(?:specialist|analyst|supervisor|clerk|representative|associate)\b/i;

export function roleFor(text: string): ContactRole {
  const title = text.replace(VICE_PRESIDENT, " ");
  if (NEVER_BUYER_TITLE.test(title) && !/\bchief\b/i.test(title)) return "other";
  if (!BUYER_TITLE.test(title) && NOT_BUYER_TITLE.test(title)) return "other";
  const seniorMember = MEMBER_ROLE.test(title) && DECISION_MAKER_RANK.test(text);
  return ROLE_PATTERNS.find(({ role, pattern }) => pattern.test(title) || (role === "retail" && seniorMember))?.role ?? "other";
}

/**
 * Lines that read as a title but aren't one ("President's Message March 2026", "Branches Served: ...",
 * a line quoting an address, "CEO For questions or concerns not resolved by staff").
 */
const NOT_A_TITLE = /^\s*contact\b|@|\byour\b|\be-?mail:|message|\bquestions?\b|\bconcerns?\b|\bnot resolved\b|\bmailing\b|branches served|p\.?\s?o\.?\s+box|\bby mail\b|\battn\b|\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}|\b(?:19|20)\d{2}\b|^\s*(?:operations|commercial services)\s*$/i;
/** Words a page prints where a name would be ("Accessibility Statement", "Commercial Lender", "SEND EMAIL", "Mailing Address"). */
const NOT_A_NAME =
  /\b(?:statement|e-?mail|send|contact|us|department|inquir\w*|form|request|lender|lending|banker|officer|underwriter|support|services?|press|human|resources|collections|advisor|counsel|administrator|coordinator|manager|message|branch|team|bank|union|pointe|residential|commercial|general|meeting|annual|mailing|address|questions?|concerns?|hours|location|phone|fax|office)\b/i;

/** A printed name we can greet, or null for a label that sits where a name would. */
export function cleanContactName(name: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (NOT_A_NAME.test(trimmed) || trimmed === trimmed.toUpperCase()) return null;
  return trimmed;
}

/** A printed title, or null for a heading that only looks like one. */
export function cleanContactTitle(title: string | null): string | null {
  if (!title) return null;
  const trimmed = title.trim().replace(/[,&|*:]+\s*$/, "").trim();
  return trimmed && !NOT_A_TITLE.test(trimmed) ? trimmed : null;
}

/** Mailbox names that belong to a role, so any printed name beside them may be the person in it. */
const ROLE_MAILBOX = /ceo|president|cfo|coo|cmo|marketing|retail|deposit|operations|exec/i;

/**
 * False when a personal address can't be the printed name's ("Claire Speedling" beside
 * dawns@...): the name and title on the page belong to someone else, so neither is used.
 */
export function nameFitsEmail(name: string | null, email: string): boolean {
  if (!name) return true;
  const local = email.split("@")[0].toLowerCase().replace(/[^a-z]/g, "");
  if (ROLE_MAILBOX.test(local)) return true;
  const words = name.toLowerCase().replace(/[^a-z\s-]/g, " ").split(/[\s-]+/).filter((word) => word.length >= 2);
  if (words.some((word) => word.length >= 3 && local.includes(word))) return true;
  const first = words[0];
  const last = words.at(-1);
  if (!first || !last || words.length < 2) return false;
  // Truncated mailboxes ("tjcollin" for Tim Collins) keep the surname's first five letters.
  return local.startsWith(`${first[0]}${last.slice(0, 3)}`) || (last.length >= 5 && local.includes(last.slice(0, 5)));
}

/**
 * A saved contact read with today's rules: its name and title checked again and its role
 * re-read from the title, so rows saved before a rule changed are judged the same way. A
 * name that can't own the contact's personal address drops, with its title. A "Contact <name>,
 * <title>" sentence printed where a title would be is split into the two.
 */
/** "Contact Nicole Andrushko, VP of Marketing, at": a sentence that names the person and their title. */
const CONTACT_SENTENCE = /^\s*[Cc]ontact\s+([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+){1,2}),\s*(.+?)(?:,?\s+at)?\s*[.:,]?\s*$/;

/** The name and title out of a "Contact <name>, <title>, at" line, or null for any other line. */
export function splitContactSentence(line: string | null): { name: string; title: string } | null {
  const match = line ? CONTACT_SENTENCE.exec(line) : null;
  return match ? { name: match[1], title: match[2] } : null;
}

export function normalizeContact<T extends { name: string | null; title: string | null; role: ContactRole; kind: ContactKind; email?: string }>(input: T): T {
  const sentence = input.name ? null : splitContactSentence(input.title);
  const contact = sentence ? { ...input, name: sentence.name, title: sentence.title } : input;
  const name = cleanContactName(contact.name);
  const owned = contact.email === undefined || nameFitsEmail(name, contact.email);
  const title = owned ? cleanContactTitle(contact.title) : null;
  return {
    ...contact,
    name: owned ? name : null,
    title,
    role: contact.kind === "person" ? (title ? roleFor(title) : "other") : contact.role,
  };
}

function looksLikeTitle(line: string): boolean {
  if (line.length > 120) return false;
  return ROLE_PATTERNS.some(({ pattern }) => pattern.test(line)) || /\b(vice president|svp|evp|avp|vp|chief|director|manager|officer|head of|chair)\b/i.test(line);
}

function looksLikeName(line: string): boolean {
  return line.length <= 60 && PERSON_NAME.test(line) && !looksLikeTitle(line);
}

/**
 * The published addresses on one page, each with the name and title printed just before it
 * (within three lines) when the page shows them. Both stay null when the page doesn't.
 */
export function extractContacts(html: string, pageUrl: string, websiteHost: string): FoundContact[] {
  const lines = pageLines(html);
  const found = new Map<string, FoundContact>();
  lines.forEach((line, index) => {
    for (const raw of line.match(EMAIL) ?? []) {
      const email = raw.replace(/^[._-]+|[._-]+$/g, "").toLowerCase();
      if (NOT_EMAIL_TLD.test(email) || !belongsToSite(email, websiteHost) || found.has(email)) continue;
      const local = email.split("@")[0];
      const kind: ContactKind = GENERAL_MAILBOX.test(local) ? "general" : "person";
      const window = lines.slice(Math.max(0, index - 3), index + 1);
      const before = window.map((text) => text.replace(raw, "").trim()).filter(Boolean);
      const title = kind === "person" ? cleanContactTitle([...before].reverse().find(looksLikeTitle) ?? null) : null;
      const name = kind === "person" ? cleanContactName([...before].reverse().find(looksLikeName) ?? null) : null;
      found.set(email, {
        email,
        kind,
        name,
        title: title ? title.slice(0, 120) : null,
        role: roleFor(title ?? (kind === "general" ? local : "")),
        sourceUrl: pageUrl,
        context: window.join(" | ").slice(0, 240),
      });
    }
  });
  // A "name" printed beside several different addresses is a heading ("North Pointe"), not a person.
  const nameUses = new Map<string, number>();
  for (const contact of found.values()) if (contact.name) nameUses.set(contact.name, (nameUses.get(contact.name) ?? 0) + 1);
  return [...found.values()].map((contact) => (contact.name && (nameUses.get(contact.name) ?? 0) > 1 ? { ...contact, name: null } : contact));
}

/** Same-site links that look like leadership, about or contact pages, best first. */
export function contactPageLinks(html: string, pageUrl: string, limit: number = CONTACT_PAGES_PER_SITE): string[] {
  const host = siteHost(pageUrl);
  if (!host) return [];
  const ranked = new Map<string, number>();
  const pattern = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    let url: URL;
    try {
      url = new URL(decodeEntities(match[1]), pageUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || siteHost(url.href) !== host) continue;
    if (/\.(pdf|jpe?g|png|gif|zip|docx?)$/i.test(url.pathname)) continue;
    const label = `${url.pathname} ${match[2].replace(/<[^>]+>/g, " ")}`;
    const hint = PAGE_HINTS.find(({ pattern: hintPattern }) => hintPattern.test(label));
    if (!hint) continue;
    url.hash = "";
    const key = url.href;
    ranked.set(key, Math.min(ranked.get(key) ?? hint.rank, hint.rank));
  }
  return [...ranked.entries()].sort((a, b) => a[1] - b[1]).slice(0, limit).map(([url]) => url);
}

/** One page as text, as `FeeInsightBot (Growth)`; never throws. */
export async function fetchText(url: string, fetcher: Fetcher): Promise<{ ok: boolean; status: number | null; url: string; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": crawlerUserAgent("Growth"), accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
    });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || (type && !/text|html|xml/i.test(type))) return { ok: false, status: response.status, url: response.url || url, text: "" };
    const text = (await response.text()).slice(0, MAX_PAGE_BYTES);
    return { ok: true, status: response.status, url: response.url || url, text };
  } catch {
    return { ok: false, status: null, url, text: "" };
  } finally {
    clearTimeout(timer);
  }
}

export interface ProspectSite {
  institutionId: number;
  name: string;
  websiteUrl: string;
}

export interface SiteCheck {
  institutionId: number;
  name: string;
  outcome: "found" | "none" | "blocked" | "unreachable";
  pagesFetched: number;
  contacts: FoundContact[];
}

/** Reads one institution's site: robots.txt, the homepage, then its leadership and contact pages. */
export async function checkSite(site: ProspectSite, fetcher: Fetcher = fetch): Promise<SiteCheck> {
  const base = { institutionId: site.institutionId, name: site.name };
  const start = /^https?:\/\//i.test(site.websiteUrl) ? site.websiteUrl : `https://${site.websiteUrl}`;
  const host = siteHost(start);
  if (!host) return { ...base, outcome: "unreachable", pagesFetched: 0, contacts: [] };

  const robots = await fetchText(new URL("/robots.txt", start).href, fetcher);
  const disallows = robots.ok ? robotsDisallows(robots.text) : [];
  const allowed = (url: string) => {
    const parsed = new URL(url);
    return robotsAllows(`${parsed.pathname}${parsed.search}`, disallows);
  };
  if (!allowed(start)) return { ...base, outcome: "blocked", pagesFetched: 0, contacts: [] };

  const home = await fetchText(start, fetcher);
  if (!home.ok) return { ...base, outcome: "unreachable", pagesFetched: 0, contacts: [] };
  const finalHost = siteHost(home.url) ?? host;

  const contacts = new Map<string, FoundContact>();
  const keep = (list: FoundContact[]) => list.forEach((contact) => contacts.has(contact.email) || contacts.set(contact.email, contact));
  keep(extractContacts(home.text, home.url, finalHost));

  let pagesFetched = 1;
  const pages = contactPageLinks(home.text, home.url).filter(allowed);
  for (const page of pages) {
    const result = await fetchText(page, fetcher);
    if (!result.ok) continue;
    pagesFetched += 1;
    keep(extractContacts(result.text, result.url, finalHost));
  }
  const list = [...contacts.values()];
  return { ...base, outcome: list.length ? "found" : "none", pagesFetched, contacts: list };
}

export async function contactsSchemaReady(db: SqlTag = sql): Promise<boolean> {
  const [row] = await db`
    SELECT to_regclass('public.prospect_contacts') IS NOT NULL
       AND to_regclass('public.prospect_contact_checks') IS NOT NULL AS ready
  `;
  return row?.ready === true;
}

/**
 * Prospects due a check: the GTM plan's pool (by size and live fees) with a website, never
 * checked or last checked more than CONTACTS_RECHECK_DAYS ago, biggest local markets first.
 */
export async function loadProspectSites(db: SqlTag, limit: number): Promise<ProspectSite[]> {
  const rows = await db`
    WITH fees AS (
      SELECT institution_id, COUNT(*) AS n FROM published_fee_catalog GROUP BY institution_id
    ), live AS (
      SELECT s.id, s.institution_name, s.website_url, s.cbsa_code
        FROM institution_sources s
        JOIN fees f ON f.institution_id = s.id
       WHERE f.n >= ${PROSPECT_MIN_FEES}
         AND s.asset_size BETWEEN ${PROSPECT_MIN_ASSETS_K} AND ${PROSPECT_MAX_ASSETS_K}
         AND s.website_url IS NOT NULL AND s.website_url <> ''
    ), market AS (
      SELECT cbsa_code, COUNT(*) AS peers FROM live WHERE cbsa_code IS NOT NULL GROUP BY cbsa_code
    )
    SELECT l.id, l.institution_name, l.website_url
      FROM live l
      LEFT JOIN market m ON m.cbsa_code = l.cbsa_code
      LEFT JOIN prospect_contact_checks c ON c.institution_id = l.id
     WHERE c.institution_id IS NULL OR c.checked_at < now() - make_interval(days => ${CONTACTS_RECHECK_DAYS})
     ORDER BY c.checked_at NULLS FIRST, COALESCE(m.peers, 0) DESC, l.id
     LIMIT ${limit}
  `;
  return rows.map((row) => ({ institutionId: Number(row.id), name: String(row.institution_name), websiteUrl: String(row.website_url) }));
}

async function saveCheck(db: SqlTag, check: SiteCheck, runId: number | null): Promise<void> {
  for (const contact of check.contacts) {
    await db`
      INSERT INTO prospect_contacts (institution_id, email, kind, name, title, role, source_url, context, agent_run_id)
      VALUES (${check.institutionId}, ${contact.email}, ${contact.kind}, ${contact.name}, ${contact.title},
              ${contact.role}, ${contact.sourceUrl}, ${contact.context}, ${runId})
      ON CONFLICT (institution_id, email) DO UPDATE
         SET name = COALESCE(EXCLUDED.name, prospect_contacts.name),
             title = COALESCE(EXCLUDED.title, prospect_contacts.title),
             role = CASE WHEN EXCLUDED.title IS NOT NULL THEN EXCLUDED.role ELSE prospect_contacts.role END,
             source_url = EXCLUDED.source_url,
             context = EXCLUDED.context,
             last_seen_at = now()
    `;
  }
  await db`
    INSERT INTO prospect_contact_checks (institution_id, checked_at, pages_fetched, emails_found, outcome, agent_run_id)
    VALUES (${check.institutionId}, now(), ${check.pagesFetched}, ${check.contacts.length}, ${check.outcome}, ${runId})
    ON CONFLICT (institution_id) DO UPDATE
       SET checked_at = now(), pages_fetched = EXCLUDED.pages_fetched, emails_found = EXCLUDED.emails_found,
           outcome = EXCLUDED.outcome, agent_run_id = EXCLUDED.agent_run_id
  `;
}

export interface ContactsRunResult {
  schemaReady: boolean;
  dryRun: boolean;
  checked: number;
  found: number;
  people: number;
  general: number;
  byOutcome: Record<SiteCheck["outcome"], number>;
  byRole: Partial<Record<ContactRole, number>>;
  /** Institutions left for the next run because this one ran out of time. */
  deferred: number;
  /** The stored confidence, role and primary/backup pick, re-ranked for the institutions read (null before the migration or on a dry run). */
  picks?: ContactPicksResult | null;
}

export async function runContactFinder({
  db = sql,
  runId = null,
  limit = CONTACTS_DEFAULT_LIMIT,
  dryRun = false,
  fetcher = fetch,
  now = () => Date.now(),
}: {
  db?: SqlTag;
  runId?: number | null;
  limit?: number;
  dryRun?: boolean;
  fetcher?: Fetcher;
  now?: () => number;
}): Promise<ContactsRunResult> {
  const byOutcome: ContactsRunResult["byOutcome"] = { found: 0, none: 0, blocked: 0, unreachable: 0 };
  const empty: ContactsRunResult = { schemaReady: false, dryRun, checked: 0, found: 0, people: 0, general: 0, byOutcome, byRole: {}, deferred: 0 };
  if (!(await contactsSchemaReady(db))) return empty;

  const sites = await loadProspectSites(db, Math.min(Math.max(Math.floor(limit), 1), CONTACTS_MAX_LIMIT));
  const started = now();
  const checks: SiteCheck[] = [];
  let next = 0;
  let deferred = 0;
  const worker = async () => {
    while (next < sites.length) {
      const site = sites[next];
      next += 1;
      if (now() - started > RUN_BUDGET_MS) {
        deferred += 1;
        continue;
      }
      checks.push(await checkSite(site, fetcher));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sites.length) }, worker));

  let picks: ContactPicksResult | null = null;
  if (!dryRun) {
    for (const check of checks) await saveCheck(db, check, runId);
    // Store each contact's confidence, role and primary/backup pick for the institutions just read,
    // so /admin/growth reads them instead of ranking again.
    const touched = checks.filter((check) => check.contacts.length > 0).map((check) => check.institutionId);
    if (touched.length && (await contactPicksSchemaReady(db))) picks = await refreshContactPicks({ db, institutionIds: touched });
  }

  const byRole: ContactsRunResult["byRole"] = {};
  let people = 0;
  let general = 0;
  for (const check of checks) {
    byOutcome[check.outcome] += 1;
    for (const contact of check.contacts) {
      if (contact.kind === "person") {
        people += 1;
        byRole[contact.role] = (byRole[contact.role] ?? 0) + 1;
      } else {
        general += 1;
      }
    }
  }
  return { schemaReady: true, dryRun, checked: checks.length, found: byOutcome.found, people, general, byOutcome, byRole, deferred, picks };
}

export function summarizeContactFinder(result: ContactsRunResult): string {
  if (!result.schemaReady) return "Read no websites; the contacts tables are not there yet.";
  if (!result.checked) return "No prospect was due a contact check.";
  const parts = [
    `Read ${result.checked} prospect websites: ${result.found} published at least one address`,
    `${result.people} named or personal addresses and ${result.general} shared mailboxes`,
  ];
  const skipped = result.byOutcome.blocked + result.byOutcome.unreachable;
  if (skipped) parts.push(`${skipped} skipped (robots.txt or unreachable)`);
  if (result.deferred) parts.push(`${result.deferred} left for the next run`);
  return `${parts.join("; ")}.${result.dryRun ? " Dry run: nothing saved." : ""}`;
}

export interface ProspectContactRow {
  institution_id: number;
  institution_name: string;
  charter_type: string | null;
  state_code: string | null;
  city: string | null;
  assets_musd: number | null;
  email: string;
  kind: ContactKind;
  name: string | null;
  title: string | null;
  role: ContactRole;
  source_url: string;
  found_at: string;
  /** Stored by `refreshContactPicks`; null until the row is ranked (or absent before the migration). */
  confidence?: ContactConfidence | null;
  pick?: ContactPick | null;
}

/**
 * Every saved contact with its institution, people before shared mailboxes. Once the ranking
 * columns exist, each row carries its stored confidence and primary/backup pick.
 */
export async function listProspectContacts(db: SqlTag = sql): Promise<ProspectContactRow[]> {
  const stored = await contactPicksSchemaReady(db);
  const rows = stored
    ? await db`
        SELECT c.institution_id, s.institution_name, s.charter_type, s.state_code, s.city,
               ROUND(s.asset_size / 1000.0) AS assets_musd,
               c.email, c.kind, c.name, c.title, c.role, c.source_url, c.found_at, c.confidence, c.pick
          FROM prospect_contacts c
          JOIN institution_sources s ON s.id = c.institution_id
         ORDER BY s.state_code, s.institution_name, (c.kind = 'person') DESC, c.role, c.email
      `
    : await db`
        SELECT c.institution_id, s.institution_name, s.charter_type, s.state_code, s.city,
               ROUND(s.asset_size / 1000.0) AS assets_musd,
               c.email, c.kind, c.name, c.title, c.role, c.source_url, c.found_at
          FROM prospect_contacts c
          JOIN institution_sources s ON s.id = c.institution_id
         ORDER BY s.state_code, s.institution_name, (c.kind = 'person') DESC, c.role, c.email
      `;
  return rows.map((row) => {
    const contact = normalizeContact({
      institution_id: Number(row.institution_id),
      institution_name: String(row.institution_name),
      charter_type: row.charter_type === null ? null : String(row.charter_type),
      state_code: row.state_code === null ? null : String(row.state_code),
      city: row.city === null ? null : String(row.city),
      assets_musd: row.assets_musd === null ? null : Number(row.assets_musd),
      email: String(row.email),
      kind: row.kind as ContactKind,
      name: row.name === null ? null : String(row.name),
      title: row.title === null ? null : String(row.title),
      role: row.role as ContactRole,
      source_url: String(row.source_url),
      found_at: new Date(row.found_at as string).toISOString(),
    });
    return stored
      ? { ...contact, confidence: parseConfidence(row.confidence), pick: parsePick(row.pick) }
      : contact;
  });
}

export interface ContactCounts {
  checked: number;
  withContacts: number;
  people: number;
  general: number;
}

/** Counts for the Growth page: institutions checked, with an address, and addresses kept. */
export async function contactCounts(db: SqlTag = sql): Promise<ContactCounts | null> {
  if (!(await contactsSchemaReady(db))) return null;
  const [row] = await db`
    SELECT (SELECT COUNT(*) FROM prospect_contact_checks) AS checked,
           (SELECT COUNT(DISTINCT institution_id) FROM prospect_contacts) AS with_contacts,
           (SELECT COUNT(*) FROM prospect_contacts WHERE kind = 'person') AS people,
           (SELECT COUNT(*) FROM prospect_contacts WHERE kind = 'general') AS general
  `;
  return { checked: Number(row.checked), withContacts: Number(row.with_contacts), people: Number(row.people), general: Number(row.general) };
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * How sure we are the address reaches a decision-maker (James, 15:39 Oct 8: each prospect
 * needs a contact, title, source, email and confidence level). High: a named person with a
 * title in a buying role. Medium: a person's own address with a name or title, but not a
 * buying role. Low: a person's address with neither, or a shared mailbox.
 */
export type ContactConfidence = "high" | "medium" | "low";

export function contactConfidence(contact: Pick<ProspectContactRow, "kind" | "name" | "title" | "role">): ContactConfidence {
  if (contact.kind !== "person") return "low";
  if (contact.name && contact.title && contact.role !== "other") return "high";
  return contact.name || contact.title ? "medium" : "low";
}

/** Who the first email goes to, best first: marketing and deposit owners before the CEO. */
const ROLE_PRIORITY: Record<ContactRole, number> = {
  marketing: 0,
  retail: 1,
  executive: 2,
  finance: 3,
  operations: 4,
  compliance: 5,
  other: 6,
};
const CONFIDENCE_PRIORITY: Record<ContactConfidence, number> = { high: 0, medium: 1, low: 2 };

/** One institution's contacts, best first; the first is the primary and the second the backup. */
export function rankContacts<T extends Pick<ProspectContactRow, "kind" | "name" | "title" | "role" | "email">>(contacts: T[]): T[] {
  return [...contacts].sort(
    (a, b) =>
      CONFIDENCE_PRIORITY[contactConfidence(a)] - CONFIDENCE_PRIORITY[contactConfidence(b)] ||
      ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role] ||
      a.email.localeCompare(b.email),
  );
}

/**
 * A first email goes only to a person whose printed title is a buying role (marketing, retail
 * and deposits, the executive team, finance, operations, compliance). A person's address with a
 * lender's, branch or committee title, or with a name and no title, is not a decision-maker.
 * (Re-exported by `outreach.ts`, where it was first written.)
 */
export function isDecisionMaker(contact: Pick<ProspectContactRow, "kind" | "role" | "email">): boolean {
  return contact.kind === "person" && contact.role !== "other" && !isSharedMailbox(contact.email);
}

/** The institution's buyer contact the first email goes to, and the one behind it. */
export type ContactPick = "primary" | "backup";

const CONFIDENCES: readonly ContactConfidence[] = ["high", "medium", "low"];
const PICKS: readonly ContactPick[] = ["primary", "backup"];
function parseConfidence(value: unknown): ContactConfidence | null {
  return CONFIDENCES.includes(value as ContactConfidence) ? (value as ContactConfidence) : null;
}
function parsePick(value: unknown): ContactPick | null {
  return PICKS.includes(value as ContactPick) ? (value as ContactPick) : null;
}

/**
 * One institution's contacts, each with its confidence and its pick: among the decision-makers
 * (`isDecisionMaker`) in `rankContacts` order, the first is primary and the second backup; every
 * other contact has no pick. The same choice `buildOutreachDraft` makes. Pass contacts already
 * read with today's rules (`normalizeContact`).
 */
export function pickContacts<T extends Pick<ProspectContactRow, "kind" | "name" | "title" | "role" | "email">>(
  contacts: T[],
): Array<T & { confidence: ContactConfidence; pick: ContactPick | null }> {
  const buyers = rankContacts(contacts).filter(isDecisionMaker);
  const pickOf = new Map<T, ContactPick>();
  if (buyers[0]) pickOf.set(buyers[0], "primary");
  if (buyers[1]) pickOf.set(buyers[1], "backup");
  return contacts.map((contact) => ({ ...contact, confidence: contactConfidence(contact), pick: pickOf.get(contact) ?? null }));
}

/** True once `prospect_contacts` has the ranking columns (migration 20270110000031). */
export async function contactPicksSchemaReady(db: SqlTag = sql): Promise<boolean> {
  const [row] = await db`
    SELECT COUNT(*) = 3 AS ready
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'prospect_contacts'
       AND column_name IN ('confidence', 'pick', 'ranked_at')
  `;
  return row?.ready === true;
}

export interface ContactPicksResult {
  schemaReady: boolean;
  dryRun: boolean;
  /** Institutions and contacts read. */
  institutions: number;
  contacts: number;
  /** Contacts whose stored role, confidence or pick changed (or had never been stored). */
  changed: number;
  primary: number;
  backup: number;
  /** Institutions with saved contacts but no decision-maker, so no primary. */
  noBuyer: number;
  byConfidence: Record<ContactConfidence, number>;
}

/**
 * Ranks saved contacts with today's rules and stores what it finds on each row: the role
 * re-read from its title (`normalizeContact`), its confidence (`contactConfidence`) and whether
 * it is the institution's primary or backup buyer contact (`pickContacts`). Every contact of the
 * institutions read is ranked together, so a pick moves when a better contact appears. Only rows
 * whose values change are written; a dry run counts and writes nothing. Without `institutionIds`
 * it ranks every saved contact (the `growth-contact-picks` step, which also backfills rows saved
 * before the columns existed).
 */
export async function refreshContactPicks({
  db = sql,
  institutionIds,
  dryRun = false,
}: {
  db?: SqlTag;
  institutionIds?: number[];
  dryRun?: boolean;
} = {}): Promise<ContactPicksResult> {
  const byConfidence: Record<ContactConfidence, number> = { high: 0, medium: 0, low: 0 };
  const result: ContactPicksResult = { schemaReady: false, dryRun, institutions: 0, contacts: 0, changed: 0, primary: 0, backup: 0, noBuyer: 0, byConfidence };
  if (!(await contactsSchemaReady(db)) || !(await contactPicksSchemaReady(db))) return result;
  result.schemaReady = true;
  if (institutionIds && institutionIds.length === 0) return result;

  const rows = institutionIds
    ? await db`
        SELECT id, institution_id, email, kind, name, title, role, confidence, pick, ranked_at
          FROM prospect_contacts
         WHERE institution_id = ANY(${institutionIds}::bigint[])
         ORDER BY institution_id, email
      `
    : await db`
        SELECT id, institution_id, email, kind, name, title, role, confidence, pick, ranked_at
          FROM prospect_contacts
         ORDER BY institution_id, email
      `;

  type Saved = { id: number; email: string; kind: ContactKind; name: string | null; title: string | null; role: ContactRole; stored: { role: string; confidence: unknown; pick: unknown; rankedAt: unknown } };
  const byInstitution = new Map<number, Saved[]>();
  for (const row of rows) {
    const institutionId = Number(row.institution_id);
    const contact = normalizeContact({
      email: String(row.email),
      kind: row.kind as ContactKind,
      name: row.name === null ? null : String(row.name),
      title: row.title === null ? null : String(row.title),
      role: row.role as ContactRole,
    });
    const saved: Saved = { ...contact, id: Number(row.id), stored: { role: String(row.role), confidence: row.confidence, pick: row.pick, rankedAt: row.ranked_at } };
    const list = byInstitution.get(institutionId);
    if (list) list.push(saved);
    else byInstitution.set(institutionId, [saved]);
  }

  const ids: number[] = [];
  const roles: string[] = [];
  const confidences: string[] = [];
  const picks: Array<string | null> = [];
  for (const list of byInstitution.values()) {
    result.institutions += 1;
    const ranked = pickContacts(list);
    if (!ranked.some((contact) => contact.pick === "primary")) result.noBuyer += 1;
    for (const contact of ranked) {
      result.contacts += 1;
      byConfidence[contact.confidence] += 1;
      if (contact.pick === "primary") result.primary += 1;
      if (contact.pick === "backup") result.backup += 1;
      const { stored } = contact;
      const same =
        stored.rankedAt !== null && stored.rankedAt !== undefined &&
        stored.role === contact.role && stored.confidence === contact.confidence && (stored.pick ?? null) === contact.pick;
      if (same) continue;
      ids.push(contact.id);
      roles.push(contact.role);
      confidences.push(contact.confidence);
      picks.push(contact.pick);
    }
  }
  result.changed = ids.length;
  if (!dryRun && ids.length) {
    await db`
      UPDATE prospect_contacts c
         SET role = u.role, confidence = u.confidence, pick = u.pick, ranked_at = now()
        FROM unnest(${ids}::bigint[], ${roles}::text[], ${confidences}::text[], ${picks}::text[]) AS u(id, role, confidence, pick)
       WHERE c.id = u.id
    `;
  }
  return result;
}

export function summarizeContactPicks(result: ContactPicksResult): string {
  if (!result.schemaReady) return "Ranked no contacts; the ranking columns on prospect_contacts are not there yet.";
  if (!result.contacts) return "No saved contact to rank.";
  const parts = [
    `Ranked ${result.contacts} contacts at ${result.institutions} institutions: ${result.primary} primary and ${result.backup} backup buyer contacts`,
    `confidence high ${result.byConfidence.high}, medium ${result.byConfidence.medium}, low ${result.byConfidence.low}`,
  ];
  if (result.noBuyer) parts.push(`${result.noBuyer} institutions have no decision-maker yet`);
  parts.push(`${result.changed} rows ${result.dryRun ? "would change" : "updated"}`);
  return `${parts.join("; ")}.${result.dryRun ? " Dry run: nothing saved." : ""}`;
}

/**
 * The contacts as a CSV. An institution whose rows are all ranked uses the stored confidence and
 * pick; one with any unranked row (before the backfill) is ranked here the same way.
 */
export function contactsCsv(rows: ProspectContactRow[]): string {
  const header = ["institution_id", "institution_name", "charter_type", "state_code", "city", "assets_musd", "pick", "confidence", "name", "title", "role", "email", "kind", "source_url", "found_at"] as const;
  const byInstitution = new Map<number, ProspectContactRow[]>();
  for (const row of rows) {
    const list = byInstitution.get(row.institution_id);
    if (list) list.push(row);
    else byInstitution.set(row.institution_id, [row]);
  }
  const lines: string[] = [];
  const order: Record<ContactPick, number> = { primary: 0, backup: 1 };
  for (const list of byInstitution.values()) {
    const ranked = list.every((row) => row.confidence)
      ? list.map((row) => ({ ...row, confidence: row.confidence as ContactConfidence, pick: row.pick ?? null }))
      : pickContacts(list);
    const position = new Map(rankContacts(ranked).map((row, index) => [row, index]));
    ranked
      .sort((a, b) => (a.pick ? order[a.pick] : 2) - (b.pick ? order[b.pick] : 2) || position.get(a)! - position.get(b)!)
      .forEach((row) => {
        const cells = { ...row, pick: row.pick ?? "" };
        lines.push(header.map((key) => csvCell(cells[key])).join(","));
      });
  }
  return [header.join(","), ...lines].join("\n") + "\n";
}
