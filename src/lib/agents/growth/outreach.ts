import { SITE_DOMAIN } from "@/lib/constants";
import { sql } from "@/lib/data-store/connection";
import { contentSchemaReady, insertContentDraft, setContentDraftStatus } from "@/lib/data-store/content-drafts";
import { journeySchemaReady } from "@/lib/data-store/outreach-journey";
import { contactConfidence, contactsSchemaReady, isSharedMailbox, normalizeContact, rankContacts, type ContactConfidence, type ContactKind, type ContactRole } from "./contacts";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { loadMarketSnapshot, marketLabel, SNAPSHOT_MIN_PEERS, type MarketSnapshot, type SnapshotValue } from "./market-snapshot";

/**
 * CARNEGIE's first-email drafts (GTM plan, James 15:25-15:39 UTC Oct 8; reshaped by his
 * feedback at 22:23 UTC Oct 8). One draft per prospect with a published decision-maker contact
 * and at least OUTREACH_MIN_FINDINGS fees where its own value and at least SNAPSHOT_MIN_PEERS named
 * local competitors' values all verify (`checkFeeAgainstSource` on every row behind them, via the
 * market snapshot). The email names those competitors and links to the prospect's snapshot page,
 * which shows the same figures with a link to each schedule; a draft is written only after that
 * page is fetched and found to show them. Comparisons are local only, because the page is local
 * (the 21:31 "Statewide" fallback can't be delivered by the page, so it no longer drafts).
 *
 * Nothing sends. James, 15:14: "agents DRAFT, never send these"; 15:39: "DONT SEND THE EMAIL".
 * The draft lands in the /admin/growth queue with an audit block under the email: the
 * schedule line and link behind every figure, the rows' conditions, and the peers left out as
 * unverified, so James can check each comparison before he sends it himself from Outlook.
 */

type SqlTag = typeof sql;

export const OUTREACH_WORKFLOW = "outreach";
/** James: "Have the first 25 contact records ready and reviewed" (15:39 Oct 8). */
export const OUTREACH_DEFAULT_LIMIT = 25;
export const OUTREACH_MAX_LIMIT = 40;
/** A prospect is not drafted twice within this window, skipped drafts included. */
export const OUTREACH_REPEAT_DAYS = 60;
/** Prospects whose snapshot is read before a run stops, so one run stays within its time. */
export const OUTREACH_MAX_CANDIDATES = 120;
export const OUTREACH_CAMPAIGN = "outreach-launch";
/**
 * CAN-SPAM: a commercial email carries a valid postal address (a PO box or mail-forwarding
 * address counts) and a way to opt out. The site's mailing address stays blank by James's rule,
 * so the draft holds a placeholder he fills before sending; nothing is invented.
 */
export const OUTREACH_POSTAL_ADDRESS = "[postal address: James to add before sending]";
/** The plan's segments: $500M-$2B first, then $100M-$500M (asset_size is in thousands). */
export const OUTREACH_FIRST_SEGMENT_K = [500_000, 2_000_000] as const;
export const OUTREACH_SECOND_SEGMENT_K = [100_000, 500_000] as const;

export interface OutreachContact {
  email: string;
  kind: ContactKind;
  name: string | null;
  title: string | null;
  role: ContactRole;
  source_url: string;
}

export interface OutreachCandidate {
  institutionId: number;
  assetsK: number | null;
  contacts: OutreachContact[];
}

const money = (value: number) => (Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`);

const HONORIFIC = /^(mr|mrs|ms|miss|dr|mx)\.?$/i;

/** The first name for the greeting, or null when the page printed none. */
export function firstName(name: string | null): string | null {
  if (!name) return null;
  const words = name.split(/\s+/).filter((word) => word && !HONORIFIC.test(word));
  const first = words[0]?.replace(/[^\p{L}'-]/gu, "");
  return first && first.length > 1 ? first : null;
}

export function snapshotLink(institutionId: number): string {
  return `https://${SITE_DOMAIN}/institution/${institutionId}/market?utm_source=email&utm_medium=outreach&utm_campaign=${OUTREACH_CAMPAIGN}&utm_content=inst-${institutionId}`;
}

/** One fee the email reports: the prospect's verified value beside its verified local competitors. */
export interface OutreachFinding {
  category: string;
  label: string;
  own: SnapshotValue;
  peers: SnapshotValue[];
  median: number;
  low: SnapshotValue;
  high: SnapshotValue;
}

export interface OutreachDraft {
  subject: string;
  title: string;
  caption: string;
  primary: OutreachContact & { confidence: ContactConfidence };
  backup: (OutreachContact & { confidence: ContactConfidence }) | null;
  /** Every fee that qualified, in the order the email lists them (the email shows the first OUTREACH_EMAIL_FINDINGS). */
  findings: OutreachFinding[];
  /** Distinct named competitors with a verified value in any finding. */
  competitorCount: number;
  link: string;
}

/**
 * A draft needs this many fees where the prospect's own value and at least SNAPSHOT_MIN_PEERS
 * named local competitors' values all trace to their schedules (James, 22:23 UTC Oct 8: "stop
 * building outreach around isolated above/below-median overdraft comparisons").
 */
export const OUTREACH_MIN_FINDINGS = 3;
/** The email lists this many; the snapshot page shows them all. */
export const OUTREACH_EMAIL_FINDINGS = 4;

/**
 * A first email goes only to a person whose printed title is a buying role (marketing, retail
 * and deposits, the executive team, finance, operations, compliance). A person's address with a
 * lender's, branch or committee title, or with a name and no title, is not a decision-maker.
 */
export function isDecisionMaker(contact: Pick<OutreachContact, "kind" | "role" | "email">): boolean {
  return contact.kind === "person" && contact.role !== "other" && !isSharedMailbox(contact.email);
}

export type OutreachSkip = "no_contact" | "no_market" | "too_few_findings" | "destination_not_live";

function contactLine(contact: OutreachContact & { confidence: ContactConfidence }): string {
  const who = [contact.name, contact.title].filter(Boolean).join(", ") || "No name printed";
  return `${who} <${contact.email}> (confidence ${contact.confidence}; published at ${contact.source_url})`;
}

function valueLine(name: string, value: SnapshotValue): string {
  const read = value.readAt ? `, schedule read ${value.readAt.slice(0, 10)}` : "";
  const line = `${value.feeName ? ` Fee: "${value.feeName}".` : ""}${value.sourceLine ? ` Schedule line: "${value.sourceLine}".` : ""}`;
  const notes = value.notes.length ? ` ${value.notes.join("; ")}.` : "";
  return `- ${name}: ${money(value.value)} (${value.documentUrl ?? "no document link"}${read}).${line}${notes}`;
}

/** The fees that qualify, overdraft and NSF first (they lead most schedules), then by competitor count. */
export function outreachFindings(snapshot: MarketSnapshot): OutreachFinding[] {
  const findings: OutreachFinding[] = [];
  for (const fee of snapshot.fees) {
    const own = fee.subject;
    if (!own?.verified || fee.verifiedMedian === null || fee.verifiedPeerCount < SNAPSHOT_MIN_PEERS) continue;
    const peers = fee.peers.filter((peer) => peer.verified);
    findings.push({ category: fee.category, label: getDisplayName(fee.category), own, peers, median: fee.verifiedMedian, low: peers[0], high: peers[peers.length - 1] });
  }
  const lead = (category: string) => (category === "overdraft" ? 0 : category === "nsf" ? 1 : 2);
  return findings.sort((a, b) => lead(a.category) - lead(b.category) || b.peers.length - a.peers.length || a.category.localeCompare(b.category));
}

/**
 * The draft for one prospect, or why it gets none. Every figure and name in the email is a
 * verified value from the snapshot the link opens, so the page shows exactly what the email
 * promises. The email reports what the schedules say and makes no recommendation on pricing
 * (James, 22:23 UTC Oct 8: "We are not advising financial institutions to change their fees").
 */
export function buildOutreachDraft(snapshot: MarketSnapshot, contacts: OutreachContact[]): { draft: OutreachDraft } | { skip: OutreachSkip } {
  const ranked = rankContacts(contacts).filter(isDecisionMaker);
  if (ranked.length === 0) return { skip: "no_contact" };
  if (!snapshot.subject.cbsaCode) return { skip: "no_market" };
  const findings = outreachFindings(snapshot);
  if (findings.length < OUTREACH_MIN_FINDINGS) return { skip: "too_few_findings" };

  const [primaryContact, backupContact] = ranked;
  const primary = { ...primaryContact, confidence: contactConfidence(primaryContact) };
  const backup = backupContact ? { ...backupContact, confidence: contactConfidence(backupContact) } : null;
  const institution = snapshot.subject.name;
  const market = marketLabel(snapshot.subject);
  const names = new Map(snapshot.peers.map((peer) => [peer.id, peer.name]));
  const peerName = (id: number) => names.get(id) ?? `Institution ${id}`;
  const competitorCount = new Set(findings.flatMap((finding) => finding.peers.map((peer) => peer.institutionId))).size;
  const shown = findings.slice(0, OUTREACH_EMAIL_FINDINGS);
  const link = snapshotLink(snapshot.subject.id);
  const subject = `${institution}'s published fees beside ${competitorCount} ${market} institutions`;
  const greetingName = firstName(primary.name);
  const findingLine = (finding: OutreachFinding) =>
    `- ${finding.label}: ${institution} ${money(finding.own.value)}. ${finding.peers.length} local schedules range from ${money(finding.low.value)} (${peerName(finding.low.institutionId)}) to ${money(finding.high.value)} (${peerName(finding.high.institutionId)}), median ${money(finding.median)}.`;

  const email = [
    `Subject: ${subject}`,
    "",
    greetingName ? `Hi ${greetingName},` : "Hello,",
    "",
    `Fee Insight compiled ${institution}'s published fee schedule beside the schedules of ${competitorCount} banks and credit unions in ${market}. ${findings.length} of ${institution}'s fees can each be compared with at least ${SNAPSHOT_MIN_PEERS} local institutions' own published figures. A few of them:`,
    "",
    ...shown.map(findingLine),
    "",
    "Every figure, each competitor's included, links to the schedule it came from:",
    link,
    "",
    "This is independent research for your team's own review, not a recommendation on pricing. I'm curious: does your team handle competitive fee reviews internally, or do you use an outside research provider?",
    "",
    "Best,",
    "James",
    "Fee Insight",
    "",
    "--",
    `Fee Insight LLC · ${OUTREACH_POSTAL_ADDRESS}`,
    `If you'd rather not hear from me again, reply "no thanks" and I won't follow up.`,
  ];

  const audit = [
    "--- For your audit. Not part of the email; delete before sending. ---",
    `To: ${contactLine(primary)}`,
    backup ? `Backup: ${contactLine(backup)}` : "Backup: none published",
    `Link checked live before drafting: ${link}`,
    "",
    ...findings.flatMap((finding, index) => {
      const unverified = snapshot.fees.find((fee) => fee.category === finding.category)?.peers.filter((peer) => !peer.verified) ?? [];
      return [
        `${index + 1}. ${finding.label}${index < OUTREACH_EMAIL_FINDINGS ? "" : " (on the page, not in the email)"}`,
        valueLine(institution, finding.own),
        ...finding.peers.map((peer) => valueLine(peerName(peer.institutionId), peer)),
        ...(unverified.length ? [`  Left out as unverified: ${unverified.map((peer) => `${peerName(peer.institutionId)} ${money(peer.value)}`).join(", ")}`] : []),
        "",
      ];
    }),
    "Before sending, check each quoted line is the same consumer charge as the fee named (same account type, current schedule, no condition that makes it a different charge).",
  ];

  return {
    draft: {
      subject,
      title: `${institution}: ${findings.length} fees beside ${competitorCount} ${market} institutions`,
      caption: [...email, "", ...audit].join("\n"),
      primary,
      backup,
      findings,
      competitorCount,
      link,
    },
  };
}

const HTML_ENTITIES: Record<string, string> = { "&amp;": "&", "&#x27;": "'", "&#39;": "'", "&quot;": "\"", "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " };

/**
 * The link works and delivers what the email promises: it answers 200 and the page shows the
 * institution, every competitor the email names and every amount it quotes (James, 22:23 UTC
 * Oct 8: "Every outreach email must have a verified, working destination").
 */
export async function checkOutreachDestination(
  link: string,
  expected: { names: string[]; amounts: number[] },
  fetcher: (url: string) => Promise<{ ok: boolean; text: () => Promise<string> }> = (url) => fetch(url, { redirect: "follow", cache: "no-store" }),
): Promise<boolean> {
  try {
    const response = await fetcher(link);
    if (!response.ok) return false;
    const page = (await response.text()).replace(/&(?:amp|#x27|#39|quot|apos|lt|gt|nbsp);/g, (entity) => HTML_ENTITIES[entity]);
    const amountShown = (value: number) => {
      const [whole, fraction] = value.toFixed(2).split(".");
      return new RegExp(`\\$${whole}${fraction === "00" ? "(?:\\.00)?" : `\\.${fraction}`}(?![\\d.])`).test(page);
    };
    return expected.names.every((name) => page.includes(name)) && expected.amounts.every(amountShown);
  } catch {
    return false;
  }
}

/** Prospects with saved contacts, $500M-$2B first, then $100M-$500M, biggest first. */
export async function loadOutreachCandidates(db: SqlTag, limit: number): Promise<OutreachCandidate[]> {
  const rows = await db`
    SELECT c.institution_id, s.asset_size, c.email, c.kind, c.name, c.title, c.role, c.source_url
      FROM prospect_contacts c
      JOIN institution_sources s ON s.id = c.institution_id
     WHERE s.asset_size BETWEEN ${OUTREACH_SECOND_SEGMENT_K[0]} AND ${OUTREACH_FIRST_SEGMENT_K[1]}
       AND s.closed_date IS NULL AND s.cbsa_code IS NOT NULL
     ORDER BY (s.asset_size >= ${OUTREACH_FIRST_SEGMENT_K[0]}) DESC, s.asset_size DESC, c.institution_id, c.email
  `;
  // Every institution with saved contacts, biggest first; only those with a decision-maker
  // count toward the limit, so a run of non-buyer contacts at bigger banks can't crowd out a
  // smaller bank that has one.
  const byInstitution = new Map<number, OutreachCandidate>();
  for (const row of rows) {
    const id = Number(row.institution_id);
    let candidate = byInstitution.get(id);
    if (!candidate) {
      candidate = { institutionId: id, assetsK: row.asset_size === null ? null : Number(row.asset_size), contacts: [] };
      byInstitution.set(id, candidate);
    }
    candidate.contacts.push(normalizeContact({
      email: String(row.email),
      kind: row.kind as ContactKind,
      name: row.name === null ? null : String(row.name),
      title: row.title === null ? null : String(row.title),
      role: row.role as ContactRole,
      source_url: String(row.source_url),
    }));
  }
  return [...byInstitution.values()].filter((candidate) => candidate.contacts.some(isDecisionMaker)).slice(0, limit);
}

export interface OutreachRunResult {
  schemaReady: boolean;
  dryRun: boolean;
  considered: number;
  drafted: number;
  draftIds: number[];
  skipped: Partial<Record<OutreachSkip | "drafted_recently", number>>;
  /** Unreviewed drafts taken back (not a decision-maker, an older email format, or a quoted fee no longer live). */
  withdrawn?: number;
  reason: string | null;
}

/** Who withdrew a draft, and why, as the skip shows it on /admin/growth. */
export const OUTREACH_WITHDRAWN_BY = "carnegie";
export const OUTREACH_WITHDRAWN_REASON = "Withdrawn by CARNEGIE: the addressee is not a decision-maker (lender, branch, committee or shared mailbox).";
export const OUTREACH_STALE_QUOTE_REASON = "Withdrawn by CARNEGIE: an older single-fee email; the institution is drafted again in the multi-fee format if its fees qualify.";
export const OUTREACH_NOT_LIVE_REASON = "Withdrawn by CARNEGIE: a fee the email quotes is no longer live or is waiting on a takedown second look; the institution is drafted again if its fees still qualify.";
/**
 * Drafts carry the rule they were written under; anything older is withdrawn. 2 = the catalog row's
 * own excerpt, consumer tier first; 3 = several verified fees with named local competitors and a
 * destination checked live (James, 22:23 UTC Oct 8).
 */
export const OUTREACH_QUOTE_RULE = 3;

/** Published rows a draft quotes that are gone from the catalog or have a pending takedown. */
async function notLiveCount(db: SqlTag, publishedIds: number[]): Promise<number> {
  if (publishedIds.length === 0) return 0;
  const [row] = await db`
    SELECT count(*)::int AS n FROM unnest(${publishedIds}::bigint[]) AS q(id)
     WHERE NOT EXISTS (SELECT 1 FROM published_fee_catalog c WHERE c.fee_published_id = q.id)
        OR EXISTS (SELECT 1 FROM pipeline_feedback f WHERE f.fee_published_id = q.id AND f.kind = 'takedown_pending')
  `;
  return Number(row?.n ?? 0);
}

/**
 * Takes back first emails still waiting for review whose addressee no longer passes
 * `isDecisionMaker`, that were written under an older `OUTREACH_QUOTE_RULE`, or that quote a
 * published row (the prospect's or a named competitor's) no longer live or marked
 * `takedown_pending`. Only unreviewed drafts: anything James approved, marked sent or skipped
 * himself stays as he left it. Returns how many.
 */
export async function withdrawNonBuyerDrafts(db: SqlTag): Promise<number> {
  const rows = await db`
    SELECT id, facts FROM content_drafts
     WHERE workflow = ${OUTREACH_WORKFLOW} AND kind = 'outreach_email' AND status = 'draft'
  `;
  let withdrawn = 0;
  for (const row of rows) {
    const facts = (typeof row.facts === "string" ? JSON.parse(row.facts) : row.facts) as {
      to?: { email?: string; name?: string | null; title?: string | null; role?: ContactRole };
      quote_rule?: number;
      published_ids?: number[];
    } | null;
    const to = facts?.to;
    if (!to?.email) continue;
    const contact = normalizeContact({ name: to.name ?? null, title: to.title ?? null, role: to.role ?? "other", kind: "person" as ContactKind });
    let reason: string | null = null;
    if (!isDecisionMaker({ ...contact, email: to.email })) reason = OUTREACH_WITHDRAWN_REASON;
    else if (Number(facts?.quote_rule ?? 1) < OUTREACH_QUOTE_RULE) reason = OUTREACH_STALE_QUOTE_REASON;
    else if ((await notLiveCount(db, (facts?.published_ids ?? []).map(Number))) > 0) reason = OUTREACH_NOT_LIVE_REASON;
    if (!reason) continue;
    await setContentDraftStatus(Number(row.id), "skipped", OUTREACH_WITHDRAWN_BY, db, reason);
    withdrawn++;
  }
  return withdrawn;
}

/** Institutions drafted in the last OUTREACH_REPEAT_DAYS days, except drafts CARNEGIE withdrew. */
async function recentOutreachSubjects(db: SqlTag): Promise<Set<string>> {
  const rows = await db`
    SELECT DISTINCT subject_key FROM content_drafts
     WHERE workflow = ${OUTREACH_WORKFLOW}
       AND created_at >= now() - make_interval(days => ${OUTREACH_REPEAT_DAYS}::int)
       AND NOT (status = 'skipped' AND reviewed_by = ${OUTREACH_WITHDRAWN_BY})
  `;
  return new Set(rows.map((row) => String(row.subject_key)));
}

export async function runOutreachDrafts(input: {
  db?: SqlTag;
  runId: number | null;
  limit?: number;
  dryRun?: boolean;
  now?: Date;
  /** The live-destination check; tests pass their own. */
  checkDestination?: typeof checkOutreachDestination;
}): Promise<OutreachRunResult> {
  const checkDestination = input.checkDestination ?? checkOutreachDestination;
  const db = input.db ?? sql;
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? OUTREACH_DEFAULT_LIMIT, OUTREACH_MAX_LIMIT));
  const dryRun = input.dryRun ?? false;
  const result: OutreachRunResult = { schemaReady: false, dryRun, considered: 0, drafted: 0, draftIds: [], skipped: {}, reason: null };
  if (!(await contentSchemaReady(db)) || !(await contactsSchemaReady(db))) {
    return { ...result, reason: "content_drafts or prospect_contacts is missing" };
  }
  result.schemaReady = true;
  if (!dryRun) result.withdrawn = await withdrawNonBuyerDrafts(db);
  const recent = await recentOutreachSubjects(db);
  const candidates = await loadOutreachCandidates(db, OUTREACH_MAX_CANDIDATES);
  const skip = (key: OutreachSkip | "drafted_recently") => {
    result.skipped[key] = (result.skipped[key] ?? 0) + 1;
  };

  for (const candidate of candidates) {
    if (result.drafted >= limit) break;
    const subjectKey = `institution:${candidate.institutionId}`;
    if (recent.has(subjectKey)) {
      skip("drafted_recently");
      continue;
    }
    result.considered++;
    const snapshot = await loadMarketSnapshot(candidate.institutionId, { db });
    if (!snapshot) {
      skip("no_market");
      continue;
    }
    const built = buildOutreachDraft(snapshot, candidate.contacts);
    if ("skip" in built) {
      skip(built.skip);
      continue;
    }
    const names = new Map(snapshot.peers.map((peer) => [peer.id, peer.name]));
    const shown = built.draft.findings.slice(0, OUTREACH_EMAIL_FINDINGS);
    const live = await checkDestination(built.draft.link, {
      names: [snapshot.subject.name, ...shown.flatMap((finding) => [finding.low, finding.high].map((peer) => names.get(peer.institutionId) ?? ""))].filter(Boolean),
      amounts: shown.flatMap((finding) => [finding.own.value, finding.low.value, finding.high.value]),
    });
    if (!live) {
      skip("destination_not_live");
      continue;
    }
    result.drafted++;
    if (dryRun) continue;
    const { draft } = built;
    const draftId = await insertContentDraft(
      {
        agent: "carnegie",
        kind: "outreach_email",
        workflow: OUTREACH_WORKFLOW,
        channel: "email",
        subjectKey,
        title: draft.title,
        caption: draft.caption,
        facts: {
          institution_id: candidate.institutionId,
          institution_name: snapshot.subject.name,
          market: marketLabel(snapshot.subject),
          to: { email: draft.primary.email, name: draft.primary.name, title: draft.primary.title, role: draft.primary.role, confidence: draft.primary.confidence, source_url: draft.primary.source_url },
          backup: draft.backup ? { email: draft.backup.email, name: draft.backup.name, title: draft.backup.title, confidence: draft.backup.confidence } : null,
          subject: draft.subject,
          quote_rule: OUTREACH_QUOTE_RULE,
          findings: draft.findings.map((finding) => ({
            category: finding.category,
            own: finding.own.value,
            own_line: finding.own.sourceLine,
            own_source: finding.own.documentUrl,
            local_median: finding.median,
            verified_peers: finding.peers.length,
            low: { institution_id: finding.low.institutionId, amount: finding.low.value },
            high: { institution_id: finding.high.institutionId, amount: finding.high.value },
          })),
          competitors: draft.competitorCount,
          published_ids: [...new Set(draft.findings.flatMap((finding) => [finding.own, ...finding.peers].flatMap((value) => value.publishedIds)))],
          destination_checked_at: now.toISOString(),
          link: draft.link,
          method: "published_fee_catalog, sourced rows only; one value per institution (overdraft at its highest tier), consumer tier, never a non-customer price; every value in the email traced to its own schedule text; peers are open institutions in the same CBSA; the link was fetched and showed every name and amount the email quotes",
        },
        asOf: now,
        agentRunId: input.runId,
      },
      db,
    );
    result.draftIds.push(draftId);
  }
  if (result.drafted === 0) result.reason = `no prospect had a decision-maker contact, ${OUTREACH_MIN_FINDINGS} fees with ${SNAPSHOT_MIN_PEERS} verified local competitors each, and a live snapshot page`;
  return result;
}

const SKIP_LABELS: Record<OutreachSkip | "drafted_recently", string> = {
  drafted_recently: "drafted in the last 60 days",
  no_contact: "no decision-maker contact",
  no_market: "no local market",
  too_few_findings: `fewer than ${OUTREACH_MIN_FINDINGS} fees with ${SNAPSHOT_MIN_PEERS} verified local competitors`,
  destination_not_live: "snapshot page not live or not showing the quoted figures",
};

export function summarizeOutreach(result: OutreachRunResult): string {
  if (!result.schemaReady) return `No drafts: ${result.reason}.`;
  const skipped = Object.entries(result.skipped)
    .map(([key, count]) => `${count} ${SKIP_LABELS[key as OutreachSkip | "drafted_recently"]}`)
    .join(", ");
  const head = `${result.dryRun ? "Would draft" : "Drafted"} ${result.drafted} first emails for James to audit and send himself (${result.considered} prospects read).`;
  const withdrawn = result.withdrawn ? ` Withdrew ${result.withdrawn} unreviewed drafts (not a decision-maker, the older single-fee format, or a quoted fee no longer live).` : "";
  return (skipped ? `${head} Passed over: ${skipped}.` : head) + withdrawn;
}

/** The plan's one follow-up (GTM timeline, day 7): a week after "sent" with nothing heard back. */
export const FOLLOW_UP_AFTER_DAYS = 7;
export const FOLLOW_UP_WORKFLOW = "outreach-followup";

export interface FollowUpSource {
  draftId: number;
  /** The first email's subject, so the follow-up threads under it. */
  subject?: string | null;
  institutionId: number;
  institutionName: string;
  market: string;
  link: string;
  to: { email: string; name: string | null; title: string | null } | null;
}

/** The follow-up email: short, the same link, no new figures, an easy way to redirect it. */
export function buildFollowUpDraft(source: FollowUpSource): { subject: string; title: string; caption: string } {
  const subject = `Re: ${source.subject ?? `How your overdraft fee compares in ${source.market}`}`;
  const greetingName = firstName(source.to?.name ?? null);
  const email = [
    `Subject: ${subject}`,
    "",
    greetingName ? `Hi ${greetingName},` : "Hello,",
    "",
    `Following up once on the free, source-linked comparison of ${source.market} fee schedules I sent last week:`,
    source.link,
    "",
    "If competitive fee reviews sit with someone else on your team, I'd be glad to send it to them instead.",
    "",
    "Best,",
    "James",
    "Fee Insight",
    "",
    "--",
    `Fee Insight LLC · ${OUTREACH_POSTAL_ADDRESS}`,
    `If you'd rather not hear from me again, reply "no thanks" and I won't follow up.`,
  ];
  const audit = [
    "--- For your audit. Not part of the email; delete before sending. ---",
    source.to ? `To: ${[source.to.name, source.to.title].filter(Boolean).join(", ") || "No name printed"} <${source.to.email}>` : "To: as the first email",
    `Reply to the first email (queue item ${source.draftId}) so it threads. This is the only follow-up; after it, stop.`,
  ];
  return { subject, title: `${source.institutionName}: follow-up`, caption: [...email, "", ...audit].join("\n") };
}

export interface FollowUpRunResult {
  due: number;
  drafted: number;
  draftIds: number[];
}

/**
 * Follow-ups for first emails marked sent at least FOLLOW_UP_AFTER_DAYS ago where James has
 * recorded nothing since (no reply, call, request or decline). One per institution, ever.
 */
export async function runOutreachFollowUps(input: { db?: SqlTag; runId: number | null; dryRun?: boolean; now?: Date }): Promise<FollowUpRunResult> {
  const db = input.db ?? sql;
  const now = input.now ?? new Date();
  const result: FollowUpRunResult = { due: 0, drafted: 0, draftIds: [] };
  if (!(await contentSchemaReady(db)) || !(await journeySchemaReady(db))) return result;
  const cutoff = new Date(now.getTime() - FOLLOW_UP_AFTER_DAYS * 86_400_000).toISOString();
  const rows = await db`
    SELECT d.id, d.facts
      FROM content_drafts d
      JOIN outreach_outcomes sent ON sent.draft_id = d.id AND sent.outcome = 'sent'
     WHERE d.workflow = ${OUTREACH_WORKFLOW} AND d.kind = 'outreach_email' AND sent.created_at <= ${cutoff}
       AND NOT EXISTS (
         SELECT 1 FROM outreach_outcomes later
          WHERE later.institution_id = sent.institution_id AND later.outcome <> 'sent'
       )
       AND NOT EXISTS (
         SELECT 1 FROM content_drafts f
          WHERE f.workflow = ${FOLLOW_UP_WORKFLOW} AND f.subject_key = 'institution:' || sent.institution_id::text
       )
     ORDER BY sent.created_at
  `;
  const seen = new Set<number>();
  for (const row of rows) {
    const facts = (row.facts ?? {}) as Record<string, unknown>;
    const institutionId = Number(facts.institution_id);
    if (!Number.isInteger(institutionId) || seen.has(institutionId)) continue;
    seen.add(institutionId);
    result.due++;
    const to = facts.to && typeof facts.to === "object" ? (facts.to as Record<string, unknown>) : null;
    const source: FollowUpSource = {
      draftId: Number(row.id),
      subject: typeof facts.subject === "string" ? facts.subject : null,
      institutionId,
      institutionName: String(facts.institution_name ?? `Institution ${institutionId}`),
      market: String(facts.market ?? "your market"),
      link: String(facts.link ?? snapshotLink(institutionId)),
      to: to && typeof to.email === "string" ? { email: to.email, name: typeof to.name === "string" ? to.name : null, title: typeof to.title === "string" ? to.title : null } : null,
    };
    if (input.dryRun) continue;
    const draft = buildFollowUpDraft(source);
    const draftId = await insertContentDraft(
      {
        agent: "carnegie",
        kind: "outreach_email",
        workflow: FOLLOW_UP_WORKFLOW,
        channel: "email",
        subjectKey: `institution:${institutionId}`,
        title: draft.title,
        caption: draft.caption,
        facts: { institution_id: institutionId, institution_name: source.institutionName, market: source.market, to: source.to, link: source.link, follows_draft: source.draftId },
        asOf: now,
        agentRunId: input.runId,
      },
      db,
    );
    result.drafted++;
    result.draftIds.push(draftId);
  }
  return result;
}
