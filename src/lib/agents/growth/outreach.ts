import { SITE_DOMAIN } from "@/lib/constants";
import { sql } from "@/lib/data-store/connection";
import { contentSchemaReady, insertContentDraft, setContentDraftStatus } from "@/lib/data-store/content-drafts";
import { journeySchemaReady } from "@/lib/data-store/outreach-journey";
import { contactConfidence, contactsSchemaReady, isSharedMailbox, normalizeContact, rankContacts, type ContactConfidence, type ContactKind, type ContactRole } from "./contacts";
import { STATE_NAMES } from "@/lib/us-states";
import { isOverdraftChargeLine, loadMarketSnapshot, loadStateComparison, marketLabel, SNAPSHOT_MIN_PEERS, type MarketSnapshot, type SnapshotFee, type SnapshotValue, type StateComparison } from "./market-snapshot";

/**
 * CARNEGIE's first-email drafts (GTM plan, James 15:25-15:39 UTC Oct 8). One draft per
 * prospect with a published decision-maker contact, in James's own template, linking to the
 * prospect's free market snapshot. Every number in the email is a verified overdraft value
 * (`checkFeeAgainstSource` on every row behind it, via the market snapshot). A prospect whose
 * own overdraft fee doesn't verify gets no draft. With fewer than SNAPSHOT_MIN_PEERS verified local
 * competitors the email compares with the state instead (James, "Statewide", 21:31 UTC Oct 8),
 * and a prospect with too few verified institutions statewide as well gets no draft.
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

export interface OutreachDraft {
  subject: string;
  title: string;
  caption: string;
  primary: OutreachContact & { confidence: ContactConfidence };
  backup: (OutreachContact & { confidence: ContactConfidence }) | null;
  own: SnapshotValue;
  median: number;
  verifiedPeers: number;
  /** "local" compares with the institution's CBSA; "state" with its state when the CBSA is too thin. */
  scope: "local" | "state";
  link: string;
}

/**
 * A first email goes only to a person whose printed title is a buying role (marketing, retail
 * and deposits, the executive team, finance, operations, compliance). A person's address with a
 * lender's, branch or committee title, or with a name and no title, is not a decision-maker.
 */
export function isDecisionMaker(contact: Pick<OutreachContact, "kind" | "role" | "email">): boolean {
  return contact.kind === "person" && contact.role !== "other" && !isSharedMailbox(contact.email);
}

export type OutreachSkip =
  | "no_contact"
  | "no_market"
  | "own_fee_missing"
  | "own_fee_unverified"
  | "too_few_verified_peers";

function contactLine(contact: OutreachContact & { confidence: ContactConfidence }): string {
  const who = [contact.name, contact.title].filter(Boolean).join(", ") || "No name printed";
  return `${who} <${contact.email}> (confidence ${contact.confidence}; published at ${contact.source_url})`;
}

function valueLine(name: string, value: SnapshotValue): string {
  const read = value.readAt ? `, schedule read ${value.readAt.slice(0, 10)}` : "";
  const line = value.sourceLine ? ` Schedule line: "${value.sourceLine}".` : "";
  const notes = value.notes.length ? ` ${value.notes.join("; ")}.` : "";
  return `- ${name}: ${money(value.value)} (${value.documentUrl ?? "no document link"}${read}).${line}${notes}`;
}

/**
 * The draft for one prospect, or why it gets none. The email is James's template word for
 * word (15:39 Oct 8); every figure in it comes from the snapshot's verified values.
 */
export function buildOutreachDraft(
  snapshot: MarketSnapshot,
  contacts: OutreachContact[],
  state: StateComparison | null = null,
): { draft: OutreachDraft } | { skip: OutreachSkip } {
  const ranked = rankContacts(contacts).filter(isDecisionMaker);
  if (ranked.length === 0) return { skip: "no_contact" };
  if (!snapshot.subject.cbsaCode) return { skip: "no_market" };
  const local = snapshot.fees.find((fee) => fee.category === "overdraft");
  if (!local?.subject) return { skip: "own_fee_missing" };
  if (!local.subject.verified) return { skip: "own_fee_unverified" };
  const hasMedian = (fee: SnapshotFee | undefined) => fee !== undefined && fee.verifiedMedian !== null && fee.verifiedPeerCount >= SNAPSHOT_MIN_PEERS;
  const scope = hasMedian(local) ? "local" : hasMedian(state?.fee) ? "state" : null;
  if (scope === null) return { skip: "too_few_verified_peers" };
  const overdraft = scope === "local" ? local : state!.fee;

  const [primaryContact, backupContact] = ranked;
  const primary = { ...primaryContact, confidence: contactConfidence(primaryContact) };
  const backup = backupContact ? { ...backupContact, confidence: contactConfidence(backupContact) } : null;
  const institution = snapshot.subject.name;
  const market = marketLabel(snapshot.subject);
  const stateName = state ? (STATE_NAMES[state.stateCode] ?? state.stateCode) : "";
  const own = local.subject;
  const median = overdraft.verifiedMedian!;
  const count = overdraft.verifiedPeerCount;
  const link = snapshotLink(snapshot.subject.id);
  const subject = scope === "local" ? `How your overdraft fee compares in ${market}` : `How your overdraft fee compares across ${stateName}`;
  const comparedWith = scope === "local" ? `${count} verified local competitors` : `${count} verified banks and credit unions across ${stateName}`;
  const greetingName = firstName(primary.name);

  const email = [
    `Subject: ${subject}`,
    "",
    greetingName ? `Hi ${greetingName},` : "Hello,",
    "",
    `I was reviewing published banking fees in ${scope === "local" ? market : stateName} and noticed that ${institution}'s overdraft fee is ${money(own.value)}, compared with a median of ${money(median)} among ${comparedWith}.`,
    "",
    "We put together a free, source-backed snapshot of your competitive market:",
    link,
    "",
    "I'm curious: does your team handle competitive fee reviews internally, or do you use an outside research provider?",
    "",
    "Best,",
    "James",
    "Fee Insight",
    "",
    "--",
    `Fee Insight LLC · ${OUTREACH_POSTAL_ADDRESS}`,
    `If you'd rather not hear from me again, reply "no thanks" and I won't follow up.`,
  ];

  const names = scope === "local" ? new Map(snapshot.peers.map((peer) => [peer.id, peer.name])) : state!.names;
  const peerName = (id: number) => names.get(id) ?? `Institution ${id}`;
  const verifiedPeers = overdraft.peers.filter((peer) => peer.verified);
  const unverified = overdraft.peers.filter((peer) => !peer.verified);
  const audit = [
    "--- For your audit. Not part of the email; delete before sending. ---",
    `To: ${contactLine(primary)}`,
    backup ? `Backup: ${contactLine(backup)}` : "Backup: none published",
    "",
    `${institution}'s overdraft fee, as quoted:`,
    valueLine(institution, own),
    "",
    ...(scope === "state" ? [`Compared statewide: ${market} has ${local.verifiedPeerCount} verified local competitor${local.verifiedPeerCount === 1 ? "" : "s"}, fewer than the ${SNAPSHOT_MIN_PEERS} a local median needs.`, ""] : []),
    `The ${comparedWith} behind the ${money(median)} median:`,
    ...verifiedPeers.map((peer) => valueLine(peerName(peer.institutionId), peer)),
    ...(unverified.length
      ? ["", "Left out as unverified (the amount didn't trace to its own schedule):", ...unverified.map((peer) => `- ${peerName(peer.institutionId)}: ${money(peer.value)}`)]
      : []),
    "",
    "Before sending, check that each fee is the standard consumer overdraft fee: same account type, the schedule is current, and no condition makes it a different charge.",
  ];

  return {
    draft: {
      subject,
      title: `${institution}: ${subject}`,
      caption: [...email, "", ...audit].join("\n"),
      primary,
      backup,
      own,
      median,
      verifiedPeers: count,
      scope,
      link,
    },
  };
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
  /** Unreviewed drafts taken back because their addressee is not a decision-maker. */
  withdrawn?: number;
  reason: string | null;
}

/** Who withdrew a draft, and why, as the skip shows it on /admin/growth. */
export const OUTREACH_WITHDRAWN_BY = "carnegie";
export const OUTREACH_WITHDRAWN_REASON = "Withdrawn by CARNEGIE: the addressee is not a decision-maker (lender, branch, committee or shared mailbox).";
export const OUTREACH_WRONG_FEE_REASON = "Withdrawn by CARNEGIE: the quoted schedule line is another charge (a returned item, a charge-off or a transfer), not the overdraft fee.";

/**
 * Takes back first emails still waiting for review whose addressee no longer passes
 * `isDecisionMaker`, or whose quoted overdraft line prints another charge
 * (`isOverdraftChargeLine`): drafts made before either rule. Only unreviewed drafts: anything James
 * approved, marked sent or skipped himself stays as he left it. Returns how many.
 */
export async function withdrawNonBuyerDrafts(db: SqlTag): Promise<number> {
  const rows = await db`
    SELECT id, facts FROM content_drafts
     WHERE workflow = ${OUTREACH_WORKFLOW} AND kind = 'outreach_email' AND status = 'draft'
  `;
  let withdrawn = 0;
  for (const row of rows) {
    const facts = (typeof row.facts === "string" ? JSON.parse(row.facts) : row.facts) as { to?: { email?: string; name?: string | null; title?: string | null; role?: ContactRole }; overdraft_line?: string | null } | null;
    const to = facts?.to;
    if (!to?.email) continue;
    const contact = normalizeContact({ name: to.name ?? null, title: to.title ?? null, role: to.role ?? "other", kind: "person" as ContactKind });
    const wrongFee = typeof facts?.overdraft_line === "string" && !isOverdraftChargeLine(facts.overdraft_line);
    if (isDecisionMaker({ ...contact, email: to.email }) && !wrongFee) continue;
    await setContentDraftStatus(Number(row.id), "skipped", OUTREACH_WITHDRAWN_BY, db, wrongFee ? OUTREACH_WRONG_FEE_REASON : OUTREACH_WITHDRAWN_REASON);
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
}): Promise<OutreachRunResult> {
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
    const snapshot = await loadMarketSnapshot(candidate.institutionId, { db, categories: ["overdraft"] });
    if (!snapshot) {
      skip("no_market");
      continue;
    }
    const local = snapshot.fees.find((fee) => fee.category === "overdraft");
    const needsState = local?.subject?.verified === true && (local.verifiedMedian === null || local.verifiedPeerCount < SNAPSHOT_MIN_PEERS);
    const state = needsState ? await loadStateComparison(db, snapshot.subject, "overdraft") : null;
    const built = buildOutreachDraft(snapshot, candidate.contacts, state);
    if ("skip" in built) {
      skip(built.skip);
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
          overdraft: draft.own.value,
          overdraft_source: draft.own.documentUrl,
          overdraft_line: draft.own.sourceLine,
          comparison: draft.scope,
          local_median: draft.scope === "local" ? draft.median : null,
          state_median: draft.scope === "state" ? draft.median : null,
          verified_peers: draft.verifiedPeers,
          link: draft.link,
          method: "published_fee_catalog, sourced rows only; one value per institution (overdraft at its highest tier); every value in the email traced to its own schedule text; peers are open institutions in the same CBSA, or in the same state when the CBSA has too few verified",
        },
        asOf: now,
        agentRunId: input.runId,
      },
      db,
    );
    result.draftIds.push(draftId);
  }
  if (result.drafted === 0) result.reason = "no prospect had a decision-maker contact, a verified overdraft fee and enough verified competitors locally or statewide";
  return result;
}

const SKIP_LABELS: Record<OutreachSkip | "drafted_recently", string> = {
  drafted_recently: "drafted in the last 60 days",
  no_contact: "no decision-maker contact",
  no_market: "no local market",
  own_fee_missing: "no overdraft fee",
  own_fee_unverified: "own overdraft fee didn't verify",
  too_few_verified_peers: `fewer than ${SNAPSHOT_MIN_PEERS} verified competitors locally or statewide`,
};

export function summarizeOutreach(result: OutreachRunResult): string {
  if (!result.schemaReady) return `No drafts: ${result.reason}.`;
  const skipped = Object.entries(result.skipped)
    .map(([key, count]) => `${count} ${SKIP_LABELS[key as OutreachSkip | "drafted_recently"]}`)
    .join(", ");
  const head = `${result.dryRun ? "Would draft" : "Drafted"} ${result.drafted} first emails for James to audit and send himself (${result.considered} prospects read).`;
  const withdrawn = result.withdrawn ? ` Withdrew ${result.withdrawn} unreviewed drafts addressed to someone who isn't a decision-maker or quoting a charge that isn't the overdraft fee.` : "";
  return (skipped ? `${head} Passed over: ${skipped}.` : head) + withdrawn;
}

/** The plan's one follow-up (GTM timeline, day 7): a week after "sent" with nothing heard back. */
export const FOLLOW_UP_AFTER_DAYS = 7;
export const FOLLOW_UP_WORKFLOW = "outreach-followup";

export interface FollowUpSource {
  draftId: number;
  institutionId: number;
  institutionName: string;
  market: string;
  link: string;
  to: { email: string; name: string | null; title: string | null } | null;
}

/** The follow-up email: short, the same link, no new figures, an easy way to redirect it. */
export function buildFollowUpDraft(source: FollowUpSource): { subject: string; title: string; caption: string } {
  const subject = `Re: How your overdraft fee compares in ${source.market}`;
  const greetingName = firstName(source.to?.name ?? null);
  const email = [
    `Subject: ${subject}`,
    "",
    greetingName ? `Hi ${greetingName},` : "Hello,",
    "",
    `Following up once on the free snapshot of ${source.market} fees I sent last week:`,
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
