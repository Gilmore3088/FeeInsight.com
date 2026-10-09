import { createHash } from "node:crypto";
import { sql } from "@/lib/data-store/connection";
import { isBankingPost } from "@/lib/data-store/state-news";
import { paidModelCall, paidResponseJson, type PaidMessageCreator } from "@/lib/agents/paid-pass";
import { RegistryHttpError, registryFetch, type RegistryFetchOptions } from "@/lib/regulatory/http";
import {
  MIN_READABLE_CHARS,
  RESEARCH_SYSTEM_PROMPT,
  buildResearchPrompt,
  extractDockets,
  extractReadableText,
  isUnreadableBody,
  trackerItemId,
  validateResearch,
  type ResearchDraft,
  type ResearchItemKind,
  type ResearchSubjectKind,
} from "@/lib/regulatory/wire-research";
import { layoutDocumentText, type PdfTextItem } from "@/lib/agents/rosetta/pdf-layout";
import { mapWithConcurrency, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step `registry-wire-research`: research notes for the Regulatory Wire.
 *
 * Every 12 hours (partition "current") it picks the newest wire items that have no note yet:
 * federal agency releases, state regulator posts that pass isBankingPost, and state fee
 * bills, at most REG_WIRE_SUMMARIES_PER_RUN (default 20) a run. Press stories are never
 * picked: an outlet's story is not summarised as if it were official. For each item it reads
 * the item's own page with a plain fetch (no browser, no paid scraper), keeps the readable
 * text (a PDF's text layer too, up to WIRE_PDF_PAGES pages; a scan with no text layer stays
 * unreadable), and asks a small model for a strict JSON note using only that text. The answer is
 * checked in code (validateResearch): any date the text does not state is dropped.
 *
 * A provider step (PROVIDER_STEP_KEYS): the global provider stop and the budget caps apply,
 * and every call goes through paidModelCall, so it is budget-checked first and logged to
 * ai_api_usage_events with its cost. It is OFF by default: until REG_WIRE_SUMMARIES_LIVE=true
 * it runs in shadow mode, reads the pages and records what it would summarise (and the
 * text's size, for a cost estimate) without a model call or a write.
 */

export const WIRE_RESEARCH_SOURCE = "wire-research";
export const WIRE_RESEARCH_PARTITION = "current";
export const WIRE_RESEARCH_STEP_KEY = "registry-wire-research";
export const WIRE_RESEARCH_REFRESH_HOURS = 12;
export const DEFAULT_WIRE_RESEARCH_ITEMS = 20;
/** Never more than Magellan's per-run call cap (30, api_budget_policies agent:magellan). */
export const MAX_WIRE_RESEARCH_ITEMS = 30;
/** Items older than this are left alone: the wire is read for what is new. */
export const WIRE_RESEARCH_LOOKBACK_DAYS = 120;
/** No new item starts after this long, so the step ends well inside the tick. */
export const WIRE_RESEARCH_START_CUTOFF_MS = 100_000;
const CONCURRENCY = 3;
const MAX_OUTPUT_TOKENS = 500;
/** Pages larger than this are cut before parsing. */
const MAX_BODY_CHARS = 2_000_000;
/** State regulators post most releases and bulletins as PDFs; their first pages carry the news. */
export const WIRE_PDF_PAGES = 8;
/** A PDF larger than this is left unread rather than parsed inside the tick. */
const MAX_PDF_BYTES = 15_000_000;
const PDF_READ_TIMEOUT_MS = 10_000;
const FETCH_OPTIONS: RegistryFetchOptions = {
  retries: 0,
  timeoutMs: 15_000,
  headers: { Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,application/pdf;q=0.8,*/*;q=0.5" },
};
const STOP_ERRORS = new Set(["ProviderBudgetBlockedError", "EmergencyStopActiveError", "ProviderCircuitOpenError"]);

/** Off until James sets REG_WIRE_SUMMARIES_LIVE=true: shadow mode, no model call. */
export function wireSummariesLive(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.REG_WIRE_SUMMARIES_LIVE === "true";
}

/**
 * The repo's existing cheap model choice (the paid find and verify passes use it too), priced
 * in ANTHROPIC_PRICES_USD_PER_MTOK. Override with REG_WIRE_SUMMARY_MODEL.
 */
export function wireResearchModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.REG_WIRE_SUMMARY_MODEL?.trim() || "claude-haiku-4-5-20251001";
}

export function wireResearchLimit(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt(env.REG_WIRE_SUMMARIES_PER_RUN ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_WIRE_RESEARCH_ITEMS;
  return Math.min(n, MAX_WIRE_RESEARCH_ITEMS);
}

export interface WireResearchCandidate {
  itemKind: ResearchItemKind;
  itemId: string;
  subject: ResearchSubjectKind;
  source: string;
  headline: string;
  url: string;
  /** ISO day or timestamp; null when the item gives none. */
  published: string | null;
}

interface ArticleCandidateRow {
  guid: string;
  source: string;
  title: string;
  link: string;
  published: string | null;
}

interface BillCandidateRow {
  source: string;
  external_id: string;
  jurisdiction: string;
  identifier: string | null;
  title: string;
  url: string;
  published: string | Date | null;
}

function iso(value: string | Date | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Merges the two reads newest first: federal releases, banking posts and bills, never press. */
export function pickCandidates(articles: ArticleCandidateRow[], bills: BillCandidateRow[], limit: number): WireResearchCandidate[] {
  const out: WireResearchCandidate[] = [];
  for (const a of articles) {
    if (a.source.startsWith("news:")) continue;
    const isState = a.source.startsWith("state:");
    if (isState && !isBankingPost(a.title)) continue;
    if (!/^https?:\/\//i.test(a.link)) continue;
    out.push({
      itemKind: "article",
      itemId: a.guid,
      subject: isState ? "state_regulator_post" : "federal_release",
      source: a.source,
      headline: a.title,
      url: a.link,
      published: a.published,
    });
  }
  for (const b of bills) {
    if (!/^https?:\/\//i.test(b.url)) continue;
    out.push({
      itemKind: "tracker",
      itemId: trackerItemId(b.source, b.external_id),
      subject: "state_bill",
      source: `${b.source}:${b.jurisdiction}`,
      headline: b.identifier ? `${b.identifier}: ${b.title}` : b.title,
      url: b.url,
      published: iso(b.published),
    });
  }
  return out
    .sort((a, b) => {
      if (a.published === b.published) return 0;
      if (!a.published) return 1;
      if (!b.published) return -1;
      return b.published.localeCompare(a.published);
    })
    .slice(0, limit);
}

/** Newest wire items without a note, federal releases, banking posts and bills. */
export async function loadWireResearchCandidates(db: RegistryDb, limit: number, now: Date): Promise<WireResearchCandidate[]> {
  const since = new Date(now.getTime() - WIRE_RESEARCH_LOOKBACK_DAYS * 86_400_000).toISOString();
  // Every reg_articles item but press ("news:XX"): federal releases and state regulator
  // posts. Read extra: department-wide state feeds lose many posts to the banking filter.
  const articles = (await db`
    SELECT a.guid, a.source, a.title, a.link, COALESCE(a.published_at, a.created_at::text) AS published
      FROM reg_articles a
     WHERE a.source NOT LIKE 'news:%'
       AND COALESCE(a.published_at, a.created_at::text) >= ${since}
       AND NOT EXISTS (SELECT 1 FROM reg_wire_research r WHERE r.item_kind = 'article' AND r.item_id = a.guid)
     ORDER BY COALESCE(a.published_at, a.created_at::text) DESC
     LIMIT ${limit * 5}
  `) as unknown as ArticleCandidateRow[];
  const bills = (await db`
    SELECT t.source, t.external_id, t.jurisdiction, t.identifier, t.title, t.url,
           COALESCE(t.stage_on, t.published_on) AS published
      FROM reg_tracker_items t
     WHERE t.source = 'open_states'
       AND cardinality(t.topics) > 0
       AND COALESCE(t.stage_on, t.published_on) >= ${since.slice(0, 10)}::date
       AND NOT EXISTS (
         SELECT 1 FROM reg_wire_research r
          WHERE r.item_kind = 'tracker' AND r.item_id = t.source || ':' || t.external_id
       )
     ORDER BY COALESCE(t.stage_on, t.published_on) DESC
     LIMIT ${limit}
  `) as unknown as BillCandidateRow[];
  return pickCandidates([...articles], [...bills], limit);
}

export interface FetchedPage {
  status: number;
  contentType: string | null;
  body: string;
}

export type PageFetcher = (url: string) => Promise<FetchedPage>;

type PdfTextReader = (bytes: Uint8Array, maxPages: number) => Promise<string | null>;

/**
 * Text of a PDF's first `maxPages` pages, laid out by Rosetta's reader (columns kept apart,
 * letters drawn one by one put back into words), or null for a scan, a broken file or a read
 * that runs past PDF_READ_TIMEOUT_MS.
 */
export async function readPdfText(bytes: Uint8Array, maxPages: number): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const { getDocumentProxy } = await import("unpdf");
    const read = (async () => {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      try {
        const pages: PdfTextItem[][] = [];
        for (let n = 1; n <= Math.min(Number(pdf.numPages ?? 0), maxPages); n += 1) {
          const content = await (await pdf.getPage(n)).getTextContent();
          const items: PdfTextItem[] = [];
          for (const item of content.items) if ("str" in item) items.push(item);
          pages.push(items);
        }
        return layoutDocumentText(pages);
      } finally {
        await pdf.destroy?.();
      }
    })();
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), PDF_READ_TIMEOUT_MS);
    });
    const text = await Promise.race([read, timeout]);
    return text && text.replace(/\s+/g, "").length > 0 ? text : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The page's text as the step reads it. A PDF (by content type, or an octet-stream that starts
 * with %PDF) is handed on as the plain text of its first WIRE_PDF_PAGES pages; one with no
 * text layer, or too large, comes back empty with its PDF content type, so it reads as
 * unreadable. Images and other binaries are never parsed.
 */
export async function readFetchedPage(response: Response, readPdf: PdfTextReader = readPdfText): Promise<FetchedPage> {
  const status = response.status;
  const contentType = response.headers.get("content-type");
  if (/pdf|octet-stream/i.test(contentType ?? "")) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    const isPdf = new TextDecoder("latin1").decode(bytes.subarray(0, 5)) === "%PDF-";
    if (!isPdf || bytes.length > MAX_PDF_BYTES) return { status, contentType, body: "" };
    const text = await readPdf(bytes, WIRE_PDF_PAGES);
    return text ? { status, contentType: "text/plain", body: text.slice(0, MAX_BODY_CHARS) } : { status, contentType, body: "" };
  }
  if (/image\//i.test(contentType ?? "")) return { status, contentType, body: "" };
  const body = await response.text();
  return { status, contentType, body: body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) : body };
}

const defaultFetchPage: PageFetcher = async (url) => readFetchedPage(await registryFetch(url, FETCH_OPTIONS));

export type WireResearchOutcome =
  | "would_summarise"
  | "written"
  | "source_unreadable"
  | "invalid_output"
  | "fetch_failed"
  | "model_failed"
  | "budget_stopped"
  | "not_reached";

export interface WireResearchItemResult {
  item_kind: ResearchItemKind;
  item_id: string;
  source: string;
  headline: string;
  url: string;
  outcome: WireResearchOutcome;
  text_chars?: number;
  truncated?: boolean;
  /** Shadow mode: characters/4, a rough size for the cost estimate. Not a measured count. */
  est_input_tokens?: number;
  reason?: string;
  dropped_dates?: string[];
  cost_microusd?: number;
}

export interface RegistryWireResearchResult {
  source: string;
  partitionKey: string;
  shadow: boolean;
  dryRun: boolean;
  model: string;
  selected: number;
  written: number;
  unreadable: number;
  failed: number;
  budgetStopped: boolean;
  budgetReason: string | null;
  costMicrousd: number;
  datesDropped: number;
  schemaMissing: boolean;
  items: WireResearchItemResult[];
}

interface NoteWrite {
  candidate: WireResearchCandidate;
  status: "ok" | "source_unreadable" | "skipped";
  reason: string | null;
  draft: ResearchDraft | null;
  dockets: string[];
  sourceHash: string | null;
  sourceChars: number | null;
  model: string | null;
}

async function writeNote(db: RegistryDb, note: NoteWrite, runId: number | null): Promise<void> {
  const d = note.draft;
  await db`
    INSERT INTO reg_wire_research
      (item_kind, item_id, status, reason, summary, action_type, comment_deadline, effective_date,
       why_it_matters, dockets, source_url, source_hash, source_chars, model, agent_run_id)
    VALUES
      (${note.candidate.itemKind}, ${note.candidate.itemId}, ${note.status}, ${note.reason},
       ${d?.summary ?? null}, ${d?.actionType ?? null}, ${d?.commentDeadline ?? null}::date,
       ${d?.effectiveDate ?? null}::date, ${d?.whyItMatters ?? null}, ${note.dockets}::text[],
       ${note.candidate.url}, ${note.sourceHash}, ${note.sourceChars}, ${note.model}, ${runId})
    ON CONFLICT (item_kind, item_id) DO UPDATE SET
      status = EXCLUDED.status,
      reason = EXCLUDED.reason,
      summary = EXCLUDED.summary,
      action_type = EXCLUDED.action_type,
      comment_deadline = EXCLUDED.comment_deadline,
      effective_date = EXCLUDED.effective_date,
      why_it_matters = EXCLUDED.why_it_matters,
      dockets = EXCLUDED.dockets,
      source_url = EXCLUDED.source_url,
      source_hash = EXCLUDED.source_hash,
      source_chars = EXCLUDED.source_chars,
      model = EXCLUDED.model,
      agent_run_id = EXCLUDED.agent_run_id,
      updated_at = NOW()
  `;
}

function isMissingTable(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return message.includes("reg_wire_research") && message.includes("does not exist");
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function yearOf(published: string | null): number | null {
  const day = iso(published);
  return day ? Number(day.slice(0, 4)) : null;
}

export async function runRegistryWireResearch(
  options: {
    runId?: number | null;
    dryRun?: boolean;
    db?: RegistryDb;
    live?: boolean;
    now?: Date;
    limit?: number;
    model?: string;
    candidates?: WireResearchCandidate[];
    fetchPage?: PageFetcher;
    /** Test seam for the Messages API; paidModelCall still guards and logs every call. */
    create?: PaidMessageCreator;
    startCutoffMs?: number;
    clock?: () => number;
  } = {},
): Promise<RegistryWireResearchResult> {
  const db = options.db ?? sql;
  const now = options.now ?? new Date();
  const shadow = !(options.live ?? wireSummariesLive());
  const model = options.model ?? wireResearchModel();
  const limit = Math.min(Math.max(1, options.limit ?? wireResearchLimit()), MAX_WIRE_RESEARCH_ITEMS);
  const fetchPage = options.fetchPage ?? defaultFetchPage;
  const clock = options.clock ?? Date.now;
  const cutoff = options.startCutoffMs ?? WIRE_RESEARCH_START_CUTOFF_MS;
  const runId = options.runId ?? null;
  const dryRun = Boolean(options.dryRun);

  const result: RegistryWireResearchResult = {
    source: WIRE_RESEARCH_SOURCE,
    partitionKey: WIRE_RESEARCH_PARTITION,
    shadow,
    dryRun,
    model,
    selected: 0,
    written: 0,
    unreadable: 0,
    failed: 0,
    budgetStopped: false,
    budgetReason: null,
    costMicrousd: 0,
    datesDropped: 0,
    schemaMissing: false,
    items: [],
  };

  let candidates: WireResearchCandidate[];
  try {
    candidates = options.candidates ?? (await loadWireResearchCandidates(db, limit, now));
  } catch (error) {
    if (isMissingTable(error)) {
      result.schemaMissing = true;
      return result;
    }
    throw error;
  }
  candidates = candidates.slice(0, limit);
  result.selected = candidates.length;

  // Shadow mode and dry runs never call the model and never write a note.
  const callModel = !shadow && !dryRun;
  const startedAt = clock();
  let stopped = false;

  const store = async (note: NoteWrite) => {
    if (!callModel) return;
    await writeNote(db, note, runId);
  };

  result.items = await mapWithConcurrency(candidates, CONCURRENCY, async (c): Promise<WireResearchItemResult> => {
    const base = { item_kind: c.itemKind, item_id: c.itemId, source: c.source, headline: c.headline, url: c.url };
    if (stopped) return { ...base, outcome: result.budgetStopped ? "budget_stopped" : "not_reached" };
    if (clock() - startedAt >= cutoff) return { ...base, outcome: "not_reached" };

    let page: FetchedPage;
    try {
      page = await fetchPage(c.url);
    } catch (error) {
      const status = error instanceof RegistryHttpError ? error.status : null;
      // A page that is gone or refused for good gets an unreadable note so it is not picked
      // every run; a timeout or a server error is tried again next run.
      if (status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429) {
        await store({ candidate: c, status: "source_unreadable", reason: `http_${status}`, draft: null, dockets: [], sourceHash: null, sourceChars: null, model: null });
        return { ...base, outcome: "source_unreadable", reason: `http_${status}` };
      }
      return { ...base, outcome: "fetch_failed", reason: (error instanceof Error ? error.message : String(error)).slice(0, 160) };
    }

    if (isUnreadableBody(page.body, page.contentType)) {
      await store({ candidate: c, status: "source_unreadable", reason: "not_html_or_text", draft: null, dockets: [], sourceHash: null, sourceChars: null, model: null });
      return { ...base, outcome: "source_unreadable", reason: "not_html_or_text" };
    }
    const readable = extractReadableText(page.body, page.contentType);
    if (readable.text.length < MIN_READABLE_CHARS) {
      await store({ candidate: c, status: "source_unreadable", reason: "too_little_text", draft: null, dockets: [], sourceHash: sha256(readable.text), sourceChars: readable.text.length, model: null });
      return { ...base, outcome: "source_unreadable", reason: "too_little_text", text_chars: readable.text.length };
    }
    const sizes = { text_chars: readable.text.length, truncated: readable.truncated };
    if (!callModel) {
      return { ...base, ...sizes, outcome: "would_summarise", est_input_tokens: Math.ceil((RESEARCH_SYSTEM_PROMPT.length + readable.text.length + 400) / 4) };
    }

    const hash = sha256(readable.text);
    const dockets = extractDockets(readable.text);
    let parsed: unknown;
    let cost = 0;
    try {
      const call = await paidModelCall({
        agent: "magellan",
        operation: "wire_research_summary",
        runId: runId ?? 0,
        create: options.create,
        metadata: { step_key: WIRE_RESEARCH_STEP_KEY, item_kind: c.itemKind, item_id: c.itemId },
        params: {
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: RESEARCH_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: buildResearchPrompt({
                kind: c.subject,
                headline: c.headline,
                publishedOn: iso(c.published),
                sourceUrl: c.url,
                text: readable.text,
              }),
            },
          ],
        },
      });
      cost = call.costMicrousd;
      parsed = paidResponseJson<unknown>(call.message);
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (STOP_ERRORS.has(name)) {
        stopped = true;
        result.budgetStopped = true;
        result.budgetReason ??= error instanceof Error ? error.message : String(error);
        return { ...base, ...sizes, outcome: "budget_stopped" };
      }
      return { ...base, ...sizes, outcome: "model_failed", reason: (error instanceof Error ? error.message : String(error)).slice(0, 160) };
    }
    result.costMicrousd += cost;

    const checked = validateResearch(parsed, readable.text, yearOf(c.published));
    if (!checked.ok) {
      const status = checked.unreadable ? "source_unreadable" : "skipped";
      // Stored so a page the model cannot use is not paid for again every run.
      await store({ candidate: c, status, reason: checked.reason, draft: null, dockets, sourceHash: hash, sourceChars: readable.text.length, model });
      return { ...base, ...sizes, outcome: checked.unreadable ? "source_unreadable" : "invalid_output", reason: checked.reason, cost_microusd: cost };
    }
    await store({ candidate: c, status: "ok", reason: null, draft: checked.draft, dockets, sourceHash: hash, sourceChars: readable.text.length, model });
    result.datesDropped += checked.droppedDates.length;
    return {
      ...base,
      ...sizes,
      outcome: "written",
      cost_microusd: cost,
      ...(checked.droppedDates.length > 0 ? { dropped_dates: checked.droppedDates } : {}),
    };
  });

  result.written = result.items.filter((i) => i.outcome === "written").length;
  result.unreadable = result.items.filter((i) => i.outcome === "source_unreadable").length;
  result.failed = result.items.filter((i) => ["fetch_failed", "model_failed", "invalid_output"].includes(i.outcome)).length;
  if (dryRun) return result;

  await recordRegistryPartition(db, {
    source: WIRE_RESEARCH_SOURCE,
    partitionKey: WIRE_RESEARCH_PARTITION,
    status: result.selected > 0 ? "succeeded" : "empty",
    rowCount: result.selected,
    insertedCount: result.written,
    unmatchedCount: result.failed,
    runId,
    nextAttemptAfterHours: WIRE_RESEARCH_REFRESH_HOURS,
    detail: {
      shadow,
      model,
      selected: result.selected,
      written: result.written,
      unreadable: result.unreadable,
      failed: result.failed,
      budget_stopped: result.budgetStopped,
      cost_microusd: result.costMicrousd,
      dates_dropped: result.datesDropped,
      items: result.items,
    },
  });
  return result;
}
