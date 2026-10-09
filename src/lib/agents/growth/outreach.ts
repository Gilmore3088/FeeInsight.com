import { SITE_DOMAIN } from "@/lib/constants";
import { sql } from "@/lib/data-store/connection";
import { contentSchemaReady, insertContentDraft, setContentDraftStatus } from "@/lib/data-store/content-drafts";
import { journeySchemaReady } from "@/lib/data-store/outreach-journey";
import { contactConfidence, contactsSchemaReady, isSharedMailbox, normalizeContact, rankContacts, type ContactConfidence, type ContactKind, type ContactRole } from "./contacts";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { loadMarketSnapshot, marketLabel, SNAPSHOT_MIN_PEERS, type MarketSnapshot, type SnapshotValue } from "./market-snapshot";
import { roleProblem, scoreProspect, type ProspectScore } from "./prospect-score";

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

/** A fee's display name inside a sentence: lower case, acronyms kept ("Non-Network ATM" -> "non-network ATM"). */
export function inSentence(label: string): string {
  return label.replace(/[\p{L}']+/gu, (word) => (word.length > 1 && word === word.toUpperCase() ? word : word.toLowerCase()));
}

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

/**
 * The pilot's three first emails (James's outreach audit, 22:34 UTC Oct 8). The email sells easier,
 * source-backed competitive fee research, never the prospect's position against a median:
 * - research_efficiency (A): no figures, no link; asks how the team does competitor fee research.
 * - personalized_research (B): no figures, no link; names local institutions whose schedules we hold
 *   and offers a source-linked comparison.
 * - market_insight (C): one tier-A comparison stated as what the schedules say, and a link to the
 *   snapshot page, used only after that page is fetched and shows every name and amount.
 */
export type OutreachCampaign = "research_efficiency" | "personalized_research" | "market_insight";
export const CAMPAIGN_LETTER: Record<OutreachCampaign, "A" | "B" | "C"> = {
  research_efficiency: "A",
  personalized_research: "B",
  market_insight: "C",
};

/**
 * A credit union prospect (`charter_type` 'credit_union') gets the same three campaigns and
 * follow-ups in member wording: members rather than customers, the board, ALCO or supervisory
 * committee where the role fits, and its local peers named as the credit unions and banks they are.
 * The rules don't change: no position against a median, no pricing advice, one ask, and the same
 * Fee Insight sign-off and footer.
 */
export function isCreditUnion(charterType: string | null | undefined): boolean {
  return charterType === "credit_union";
}

/**
 * What a set of local institutions is, by charter, saying only what the set holds: "credit unions
 * and banks" when it has both, otherwise one kind (singular for one), or "institutions" when no
 * charter is on file.
 */
export function institutionKinds(charters: (string | null | undefined)[]): string {
  const one = charters.length === 1;
  const creditUnions = charters.some((charter) => charter === "credit_union");
  const banks = charters.some((charter) => charter === "bank");
  if (creditUnions && banks) return "credit unions and banks";
  if (creditUnions) return one ? "credit union" : "credit unions";
  if (banks) return one ? "bank" : "banks";
  return one ? "institution" : "institutions";
}

export interface OutreachDraft {
  campaign: OutreachCampaign;
  subject: string;
  title: string;
  caption: string;
  primary: OutreachContact & { confidence: ContactConfidence };
  backup: (OutreachContact & { confidence: ContactConfidence }) | null;
  /** Tier-A comparisons (C quotes the first; B and A quote none). */
  findings: OutreachFinding[];
  /** Fee types where the prospect and at least one named local institution both verify (B's evidence). */
  supported: SupportedFeeType[];
  /** Local institutions named in the email. */
  named: { institutionId: number; name: string }[];
  /** Only campaign C links out. */
  link: string | null;
  /** The plan's qualification score and each fee type's comparison tier. */
  score: ProspectScore;
}

/** C needs this many tier-A comparisons; B needs this many supported fee types. */
export const OUTREACH_MIN_FINDINGS = 3;

/**
 * A first email goes only to a person whose printed title is a buying role (marketing, retail
 * and deposits, the executive team, finance, operations, compliance). A person's address with a
 * lender's, branch or committee title, or with a name and no title, is not a decision-maker.
 */
export function isDecisionMaker(contact: Pick<OutreachContact, "kind" | "role" | "email">): boolean {
  return contact.kind === "person" && contact.role !== "other" && !isSharedMailbox(contact.email);
}

/**
 * The pilot campaigns James chose (`OUTREACH_CAMPAIGNS`, letters such as "A,B"). Until he chooses,
 * a real run drafts nothing (it still withdraws bad drafts); a dry run counts every campaign.
 */
export function outreachCampaignsFromEnv(value: string | undefined): OutreachCampaign[] {
  const letters = new Set((value ?? "").toUpperCase().split(/[\s,]+/).filter(Boolean));
  return (Object.keys(CAMPAIGN_LETTER) as OutreachCampaign[]).filter((campaign) => letters.has(CAMPAIGN_LETTER[campaign]));
}
export const OUTREACH_HELD_REASON = "held: James hasn't chosen the pilot campaigns yet (OUTREACH_CAMPAIGNS is unset)";

export type OutreachSkip = "no_contact" | "no_market";

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

/**
 * Tier-A comparisons: the prospect's own value and at least SNAPSHOT_MIN_PEERS named local
 * competitors' values all trace to their schedules. Overdraft and NSF first, then by peer count.
 */
export function outreachFindings(snapshot: MarketSnapshot, held: ReadonlySet<string> = new Set()): OutreachFinding[] {
  const findings: OutreachFinding[] = [];
  for (const fee of snapshot.fees) {
    const own = fee.subject;
    if (held.has(fee.category) || !own?.verified || fee.verifiedMedian === null || fee.verifiedPeerCount < SNAPSHOT_MIN_PEERS) continue;
    const peers = fee.peers.filter((peer) => peer.verified);
    findings.push({ category: fee.category, label: getDisplayName(fee.category), own, peers, median: fee.verifiedMedian, low: peers[0], high: peers[peers.length - 1] });
  }
  const lead = (category: string) => (category === "overdraft" ? 0 : category === "nsf" ? 1 : 2);
  return findings.sort((a, b) => lead(a.category) - lead(b.category) || b.peers.length - a.peers.length || a.category.localeCompare(b.category));
}

export interface SupportedFeeType {
  category: string;
  own: SnapshotValue;
  peers: SnapshotValue[];
}

/** Fee types where the prospect's own value and at least one local institution's value verify. */
export function supportedFeeTypes(snapshot: MarketSnapshot, held: ReadonlySet<string> = new Set()): SupportedFeeType[] {
  return snapshot.fees
    .filter((fee) => !held.has(fee.category) && fee.subject?.verified && fee.peers.some((peer) => peer.verified))
    .map((fee) => ({ category: fee.category, own: fee.subject!, peers: fee.peers.filter((peer) => peer.verified) }));
}

const SIGN_OFF = ["Best,", "James", "Founder, Fee Insight"];
const FOOTER = ["", "--", `Fee Insight LLC · ${OUTREACH_POSTAL_ADDRESS}`, `If you'd rather not hear from me again, reply "no thanks" and I won't follow up.`];

/**
 * The draft for one prospect, or why it gets none. The campaign follows the evidence: C when
 * `allowInsight` and there are OUTREACH_MIN_FINDINGS tier-A comparisons, B when there are that many
 * supported fee types, otherwise A. No email recommends a price or reads meaning into a difference
 * (James, 22:23 UTC Oct 8: "We are not advising financial institutions to change their fees").
 */
export function buildOutreachDraft(
  snapshot: MarketSnapshot,
  contacts: OutreachContact[],
  options: { allowInsight?: boolean; assetsK?: number | null; pendingTakedown?: ReadonlySet<number> } = {},
): { draft: OutreachDraft } | { skip: OutreachSkip } {
  const ranked = rankContacts(contacts).filter(isDecisionMaker);
  if (ranked.length === 0) return { skip: "no_contact" };

  const [primaryContact, backupContact] = ranked;
  const primary = { ...primaryContact, confidence: contactConfidence(primaryContact) };
  const backup = backupContact ? { ...backupContact, confidence: contactConfidence(backupContact) } : null;
  const institution = snapshot.subject.name;
  const market = marketLabel(snapshot.subject);
  const names = new Map(snapshot.peers.map((peer) => [peer.id, peer.name]));
  const peerName = (id: number) => names.get(id) ?? `Institution ${id}`;
  const score = scoreProspect(snapshot, primary, options.assetsK ?? null, options.pendingTakedown);
  // A comparison with a row waiting on a takedown second look (tier D) is never used.
  const held = new Set(Object.entries(score.tiers).filter(([, tier]) => tier === "D").map(([category]) => category));
  const findings = outreachFindings(snapshot, held);
  const supported = supportedFeeTypes(snapshot, held);
  const creditUnion = isCreditUnion(snapshot.subject.charterType);
  const charters = new Map(snapshot.peers.map((peer) => [peer.id, peer.charterType]));
  const kindsOf = (ids: number[]) => institutionKinds(ids.map((id) => charters.get(id)));
  const problem = roleProblem(primary, snapshot.subject.charterType);
  const campaign: OutreachCampaign =
    options.allowInsight && findings.length >= OUTREACH_MIN_FINDINGS
      ? "market_insight"
      : supported.length >= OUTREACH_MIN_FINDINGS
        ? "personalized_research"
        : "research_efficiency";
  const greetingName = firstName(primary.name);
  const greeting = [greetingName ? `Hi ${greetingName},` : "Hello,", ""];

  // The local institutions B names: those with a verified value in the most of the prospect's fee types.
  const sharedCount = new Map<number, number>();
  for (const fee of supported) for (const peer of fee.peers) sharedCount.set(peer.institutionId, (sharedCount.get(peer.institutionId) ?? 0) + 1);
  const bestPeers = [...sharedCount.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([id]) => id);

  let subject: string;
  let body: string[];
  let named: { institutionId: number; name: string }[] = [];
  let link: string | null = null;
  if (campaign === "research_efficiency") {
    subject = "Quick question about competitor fee research";
    body = creditUnion
      ? [
          `I'm James, founder of Fee Insight. ${problem.opening} usually means finding, reading and lining up dozens of published fee schedules by hand.`,
          "",
          "Fee Insight brings published credit union and bank fee schedules together in one place, with every figure linked to the schedule it came from, so a comparison that goes to the board or ALCO can be traced line by line.",
          "",
          `When your team compares ${institution}'s member fees with other credit unions and banks, do you compile that research yourselves, or do you already have a tool or consultant for it?`,
        ]
      : [
          `I'm James, founder of Fee Insight. ${problem.opening} usually means finding, reading and lining up dozens of published fee schedules by hand.`,
          "",
          "Fee Insight brings published bank and credit union fee schedules together in one place, with every figure linked to the schedule it came from.",
          "",
          `When your team compares ${institution}'s fees with other institutions, do you compile that research yourselves, or do you already have a tool or consultant for it?`,
        ];
  } else if (campaign === "personalized_research") {
    // A credit union's email names one credit union and one bank when both verify, matching "credit unions and banks".
    const creditUnionPeer = bestPeers.find((id) => isCreditUnion(charters.get(id)));
    const bankPeer = bestPeers.find((id) => charters.get(id) === "bank");
    const chosen = creditUnion && creditUnionPeer !== undefined && bankPeer !== undefined
      ? bestPeers.filter((id) => id === creditUnionPeer || id === bankPeer)
      : bestPeers.slice(0, 2);
    named = chosen.map((id) => ({ institutionId: id, name: peerName(id) }));
    subject = `Competitive fee research for ${institution}`;
    body = creditUnion
      ? [
          "I'm James, founder of Fee Insight. We compile published credit union and bank fee schedules so competitive research is faster and every figure can be traced to its source.",
          "",
          `${institution}'s schedule is in our research, along with those of ${sharedCount.size} other ${kindsOf([...sharedCount.keys()])} in the ${market} area, including ${named.map((peer) => peer.name).join(" and ")}. Between them, ${supported.length} fee types can be compared line by line.`,
          "",
          `Would a short, source-linked comparison of ${institution}'s member fees and those of a few local credit unions and banks you choose be useful for ${problem.useFor}?`,
        ]
      : [
          "I'm James, founder of Fee Insight. We compile published fee schedules so competitive research is faster and every figure can be traced to its source.",
          "",
          `${institution}'s schedule is in our research, along with those of ${sharedCount.size} other institutions in the ${market} area, including ${named.map((peer) => peer.name).join(" and ")}. Between them, ${supported.length} fee types can be compared line by line.`,
          "",
          `Would a short, source-linked comparison of ${institution} and a few local institutions you choose be useful for ${problem.useFor}?`,
        ];
  } else {
    const fact = findings[0];
    named = [fact.low, fact.high].map((peer) => ({ institutionId: peer.institutionId, name: peerName(peer.institutionId) }));
    link = snapshotLink(snapshot.subject.id);
    subject = `${market} fee schedules, side by side`;
    body = creditUnion
      ? [
          "I'm James, founder of Fee Insight. We line up published credit union and bank fee schedules so a credit union can see its market without collecting each disclosure by hand.",
          "",
          `In the ${market} schedules we hold, ${inSentence(fact.label)} fees at ${fact.peers.length} local ${kindsOf(fact.peers.map((peer) => peer.institutionId))} run from ${money(fact.low.value)} at ${named[0].name} to ${money(fact.high.value)} at ${named[1].name}. The figure ${institution} publishes for members is ${money(fact.own.value)}.`,
          "",
          `The page below shows that comparison and ${findings.length - 1} others, each figure linked to the schedule it came from:`,
          link,
          "",
          "Is competitive fee research something your team prepares regularly, for example for ALCO or the board?",
        ]
      : [
          "I'm James, founder of Fee Insight. We line up published fee schedules so institutions can see their market without collecting each disclosure by hand.",
          "",
          `In the ${market} schedules we hold, ${inSentence(fact.label)} fees run from ${money(fact.low.value)} at ${named[0].name} to ${money(fact.high.value)} at ${named[1].name}. ${institution}'s published figure is ${money(fact.own.value)}.`,
          "",
          `The page below shows that comparison and ${findings.length - 1} others, each figure linked to the schedule it came from:`,
          link,
          "",
          "Is competitive fee research something your team does regularly?",
        ];
  }
  const email = [`Subject: ${subject}`, "", ...greeting, ...body, "", ...SIGN_OFF, ...FOOTER];

  const evidence =
    campaign === "market_insight"
      ? findings.flatMap((finding, index) => {
          const unverified = snapshot.fees.find((fee) => fee.category === finding.category)?.peers.filter((peer) => !peer.verified) ?? [];
          return [
            `${index + 1}. ${finding.label}${index === 0 ? " (quoted in the email)" : " (on the page)"}`,
            valueLine(institution, finding.own),
            ...finding.peers.map((peer) => valueLine(peerName(peer.institutionId), peer)),
            ...(unverified.length ? [`  Left out as unverified: ${unverified.map((peer) => `${peerName(peer.institutionId)} ${money(peer.value)}`).join(", ")}`] : []),
            "",
          ];
        })
      : campaign === "personalized_research"
        ? [
            `Fee types where ${institution} and at least one local institution both verify (${supported.length}): ${supported.map((fee) => getDisplayName(fee.category)).join(", ")}.`,
            ...named.map((peer) => `${peer.name} verifies in ${sharedCount.get(peer.institutionId)} of them.`),
            "No figure is in the email. If they say yes, the comparison you send uses tier A figures only (5 or more verified local institutions).",
            "",
          ]
        : ["No figures or institution claims are in this email beyond its name.", ""];
  const audit = [
    `--- For your audit. Not part of the email; delete before sending. Campaign ${CAMPAIGN_LETTER[campaign]}. ---`,
    `To: ${contactLine(primary)}`,
    backup ? `Backup: ${contactLine(backup)}` : "Backup: none published",
    `Score ${score.total}/100 (fit ${score.parts.fit}/25, buyer ${score.parts.buyer}/20, research ${score.parts.research}/20, data confidence ${score.parts.confidence}/20, commercial ${score.parts.commercial}/15).`,
    `Comparison tiers: ${(["A", "B", "C", "D"] as const).map((tier) => `${tier} ${Object.values(score.tiers).filter((value) => value === tier).length}`).join(", ")}. Only tier A figures may be quoted.`,
    ...(link ? [`Link checked live before drafting: ${link}`] : ["No link: the one ask is a reply."]),
    ...(creditUnion
      ? [
          `Credit union: member wording (members, board/ALCO/supervisory committee, peers as credit unions and banks). Local institutions with live fees: ${snapshot.peers.filter((peer) => isCreditUnion(peer.charterType)).length} credit unions, ${snapshot.peers.filter((peer) => peer.charterType === "bank").length} banks.`,
        ]
      : []),
    "",
    ...evidence,
    "Before sending: confirm the recipient's title on the institution's own site, open any quoted schedule line, and check the email gives no pricing advice.",
  ];

  return {
    draft: {
      campaign,
      subject,
      title: `${institution}: campaign ${CAMPAIGN_LETTER[campaign]}, ${subject}`,
      caption: [...email, "", ...audit].join("\n"),
      primary,
      backup,
      findings,
      supported,
      named,
      link,
      score,
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
  skipped: Partial<Record<OutreachSkip | "drafted_recently" | "campaign_not_chosen", number>>;
  /** Drafts per campaign (A research efficiency, B personalized research, C market insight). */
  campaigns: Partial<Record<OutreachCampaign, number>>;
  /** Prospects with enough for C whose snapshot page didn't show the figures (drafted as B instead). */
  insightPageNotLive?: number;
  /** Unreviewed drafts taken back (not a decision-maker, an older email format or wording, or a quoted fee no longer live). */
  withdrawn?: number;
  reason: string | null;
}

/** Who withdrew a draft, and why, as the skip shows it on /admin/growth. */
export const OUTREACH_WITHDRAWN_BY = "carnegie";
export const OUTREACH_WITHDRAWN_REASON = "Withdrawn by CARNEGIE: the addressee is not a decision-maker (lender, branch, committee or shared mailbox).";
export const OUTREACH_STALE_QUOTE_REASON = "Withdrawn by CARNEGIE: an older single-fee email (James's outreach audit, Oct 8); the institution is drafted again as a pilot email.";
export const OUTREACH_STALE_WORDING_REASON = "Withdrawn by CARNEGIE: written before credit unions got member wording (Oct 9); the institution is drafted again in the current wording.";
export const OUTREACH_NOT_LIVE_REASON = "Withdrawn by CARNEGIE: a fee the email quotes is no longer live or is waiting on a takedown second look; the institution is drafted again if its fees still qualify.";
/**
 * Drafts carry the rule they were written under; anything older is withdrawn. 2 = the catalog row's
 * own excerpt, consumer tier first; 3 = the pilot's campaigns A, B and C (James's outreach audit,
 * 22:34 UTC Oct 8); 4 = the same campaigns with member wording for credit unions (Oct 9).
 */
export const OUTREACH_QUOTE_RULE = 4;
/** The first rule of the pilot's campaigns A, B and C; anything older is the single-fee email. */
const OUTREACH_PILOT_RULE = 3;

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
 * `isDecisionMaker`, that were written under an older `OUTREACH_QUOTE_RULE` (an older format or wording), or that quote a
 * published row (the prospect's or a named competitor's) no longer live or marked
 * `takedown_pending`. Only unreviewed drafts: anything James approved, marked sent or skipped
 * himself stays as he left it. Returns how many; a dry run only counts them.
 */
export async function withdrawNonBuyerDrafts(db: SqlTag, dryRun = false): Promise<number> {
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
    const contact = normalizeContact({ name: to.name ?? null, title: to.title ?? null, role: to.role ?? "other", kind: "person" as ContactKind, email: to.email ?? "" });
    let reason: string | null = null;
    if (!isDecisionMaker({ ...contact, email: to.email })) reason = OUTREACH_WITHDRAWN_REASON;
    else if (Number(facts?.quote_rule ?? 1) < OUTREACH_PILOT_RULE) reason = OUTREACH_STALE_QUOTE_REASON;
    else if (Number(facts?.quote_rule ?? 1) < OUTREACH_QUOTE_RULE) reason = OUTREACH_STALE_WORDING_REASON;
    else if ((await notLiveCount(db, (facts?.published_ids ?? []).map(Number))) > 0) reason = OUTREACH_NOT_LIVE_REASON;
    if (!reason) continue;
    if (!dryRun) await setContentDraftStatus(Number(row.id), "skipped", OUTREACH_WITHDRAWN_BY, db, reason);
    withdrawn++;
  }
  return withdrawn;
}

/** Published rows behind the prospect's and its peers' values that wait on a takedown second look. */
async function pendingTakedownIds(db: SqlTag, snapshot: MarketSnapshot): Promise<Set<number>> {
  const ids = [...new Set(snapshot.fees.flatMap((fee) => [fee.subject, ...fee.peers].flatMap((value) => value?.publishedIds ?? [])))];
  if (ids.length === 0) return new Set();
  const rows = await db`
    SELECT DISTINCT fee_published_id FROM pipeline_feedback
     WHERE kind = 'takedown_pending' AND fee_published_id = ANY(${ids}::bigint[])
  `;
  return new Set(rows.map((row) => Number(row.fee_published_id)));
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
  /** Campaigns James approved; a real run drafts only these, and nothing when none is approved. */
  campaigns?: OutreachCampaign[];
}): Promise<OutreachRunResult> {
  const checkDestination = input.checkDestination ?? checkOutreachDestination;
  const db = input.db ?? sql;
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? OUTREACH_DEFAULT_LIMIT, OUTREACH_MAX_LIMIT));
  const dryRun = input.dryRun ?? false;
  const result: OutreachRunResult = { schemaReady: false, dryRun, considered: 0, drafted: 0, draftIds: [], skipped: {}, campaigns: {}, reason: null };
  if (!(await contentSchemaReady(db)) || !(await contactsSchemaReady(db))) {
    return { ...result, reason: "content_drafts or prospect_contacts is missing" };
  }
  result.schemaReady = true;
  result.withdrawn = await withdrawNonBuyerDrafts(db, dryRun);
  const approved = new Set(input.campaigns ?? []);
  if (!dryRun && approved.size === 0) return { ...result, reason: OUTREACH_HELD_REASON };
  const recent = await recentOutreachSubjects(db);
  const candidates = await loadOutreachCandidates(db, OUTREACH_MAX_CANDIDATES);
  const skip = (key: OutreachSkip | "drafted_recently" | "campaign_not_chosen") => {
    result.skipped[key] = (result.skipped[key] ?? 0) + 1;
  };

  // Read every candidate, then draft the highest-scoring ones (the plan ranks prospects by score,
  // not by asset size).
  const built: { candidate: OutreachCandidate; snapshot: MarketSnapshot; draft: OutreachDraft }[] = [];
  for (const candidate of candidates) {
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
    const pendingTakedown = await pendingTakedownIds(db, snapshot);
    const options = { assetsK: candidate.assetsK, pendingTakedown };
    const allowInsight = dryRun || approved.has("market_insight");
    let attempt = buildOutreachDraft(snapshot, candidate.contacts, { ...options, allowInsight });
    if ("draft" in attempt && attempt.draft.campaign === "market_insight") {
      const { draft } = attempt;
      const fact = draft.findings[0];
      const live = await checkDestination(draft.link!, {
        names: [snapshot.subject.name, ...draft.named.map((peer) => peer.name)],
        amounts: [fact.own.value, fact.low.value, fact.high.value],
      });
      if (!live) {
        result.insightPageNotLive = (result.insightPageNotLive ?? 0) + 1;
        attempt = buildOutreachDraft(snapshot, candidate.contacts, { ...options, allowInsight: false });
      }
    }
    if ("skip" in attempt) {
      skip(attempt.skip);
      continue;
    }
    if (!dryRun && !approved.has(attempt.draft.campaign)) {
      skip("campaign_not_chosen");
      continue;
    }
    built.push({ candidate, snapshot, draft: attempt.draft });
  }
  built.sort((a, b) => b.draft.score.total - a.draft.score.total || a.candidate.institutionId - b.candidate.institutionId);

  for (const { candidate, snapshot, draft } of built.slice(0, limit)) {
    const subjectKey = `institution:${candidate.institutionId}`;
    result.campaigns[draft.campaign] = (result.campaigns[draft.campaign] ?? 0) + 1;
    result.drafted++;
    if (dryRun) continue;
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
          charter_type: snapshot.subject.charterType,
          to: { email: draft.primary.email, name: draft.primary.name, title: draft.primary.title, role: draft.primary.role, confidence: draft.primary.confidence, source_url: draft.primary.source_url },
          backup: draft.backup ? { email: draft.backup.email, name: draft.backup.name, title: draft.backup.title, confidence: draft.backup.confidence } : null,
          subject: draft.subject,
          campaign: draft.campaign,
          quote_rule: OUTREACH_QUOTE_RULE,
          named: draft.named,
          findings: draft.campaign === "market_insight"
            ? draft.findings.map((finding) => ({
                category: finding.category,
                own: finding.own.value,
                own_line: finding.own.sourceLine,
                own_source: finding.own.documentUrl,
                verified_peers: finding.peers.length,
                low: { institution_id: finding.low.institutionId, amount: finding.low.value },
                high: { institution_id: finding.high.institutionId, amount: finding.high.value },
              }))
            : [],
          supported_fee_types: draft.supported.map((fee) => fee.category),
          score: draft.score.total,
          score_parts: draft.score.parts,
          tiers: draft.score.tiers,
          published_ids: draft.campaign === "market_insight"
            ? [...new Set(draft.findings.flatMap((finding) => [finding.own, ...finding.peers].flatMap((value) => value.publishedIds)))]
            : [],
          destination_checked_at: draft.link ? now.toISOString() : null,
          link: draft.link,
          method: "published_fee_catalog, sourced rows only; one value per institution (overdraft at its highest tier), consumer tier, never a non-customer price; peers are open institutions in the same CBSA; only campaign C quotes figures, each traced to its own schedule text with 5+ verified local institutions, and its link was fetched and showed every name and amount it quotes",
        },
        asOf: now,
        agentRunId: input.runId,
      },
      db,
    );
    result.draftIds.push(draftId);
  }
  if (result.drafted === 0) result.reason = "no prospect had a decision-maker contact";
  return result;
}

const SKIP_LABELS: Record<OutreachSkip | "drafted_recently" | "campaign_not_chosen", string> = {
  drafted_recently: "drafted in the last 60 days",
  no_contact: "no decision-maker contact",
  no_market: "no local market",
  campaign_not_chosen: "in a campaign James hasn't chosen",
};

export function summarizeOutreach(result: OutreachRunResult): string {
  if (!result.schemaReady) return `No drafts: ${result.reason}.`;
  if (result.reason === OUTREACH_HELD_REASON) {
    const withdrew = result.withdrawn ? ` Withdrew ${result.withdrawn} unreviewed drafts that no longer qualify.` : "";
    return `No first emails drafted: ${result.reason}.${withdrew}`;
  }
  const skipped = Object.entries(result.skipped)
    .map(([key, count]) => `${count} ${SKIP_LABELS[key as OutreachSkip | "drafted_recently" | "campaign_not_chosen"]}`)
    .join(", ");
  const byCampaign = (Object.keys(CAMPAIGN_LETTER) as OutreachCampaign[])
    .filter((campaign) => result.campaigns?.[campaign])
    .map((campaign) => `${CAMPAIGN_LETTER[campaign]} ${result.campaigns[campaign]}`)
    .join(", ");
  const head = `${result.dryRun ? "Would draft" : "Drafted"} ${result.drafted} first emails for James to audit and send himself (${result.considered} prospects read)${byCampaign ? `; by campaign: ${byCampaign}` : ""}.`;
  const notLive = result.insightPageNotLive ? ` ${result.insightPageNotLive} could have had campaign C but the snapshot page didn't show their figures, so they got B.` : "";
  const withdrawn = result.withdrawn ? ` ${result.dryRun ? "Would withdraw" : "Withdrew"} ${result.withdrawn} unreviewed drafts (not a decision-maker, an older email format or wording, or a quoted fee no longer live).` : "";
  return (skipped ? `${head} Passed over: ${skipped}.` : head) + notLive + withdrawn;
}

/**
 * The pilot's two follow-ups (James's outreach audit, 22:34 UTC Oct 8: "Day 5-7: one brief follow-up
 * offering a useful example... Day 12-15: final, polite follow-up... Then stop"), counted from the
 * day the first email was marked sent, only while nothing else has been recorded for the
 * institution. The final one waits until the first follow-up was itself marked sent.
 */
export const FOLLOW_UP_AFTER_DAYS = 6;
export const FOLLOW_UP_WORKFLOW = "outreach-followup";
export const FINAL_FOLLOW_UP_AFTER_DAYS = 13;
export const FINAL_FOLLOW_UP_WORKFLOW = "outreach-followup-final";

export interface FollowUpSource {
  draftId: number;
  /** The first email's subject, so the follow-up threads under it. */
  subject?: string | null;
  institutionId: number;
  institutionName: string;
  market: string;
  link: string;
  to: { email: string; name: string | null; title: string | null } | null;
  /** 'credit_union' gets member wording (see `isCreditUnion`). */
  charterType?: string | null;
}

/**
 * The follow-up email: short, no figures, no link, an offer of an example and an easy way to
 * redirect it. A credit union's speaks of members and of ALCO or board materials.
 */
export function buildFollowUpDraft(source: FollowUpSource, stage: 1 | 2 = 1): { subject: string; title: string; caption: string } {
  const subject = `Re: ${source.subject ?? `How your overdraft fee compares in ${source.market}`}`;
  const greetingName = firstName(source.to?.name ?? null);
  const creditUnion = isCreditUnion(source.charterType);
  const firstFollowUp = [
    creditUnion
      ? `Following up once on my note last week. If it would help, I can send a short, source-linked example comparing ${source.institutionName}'s member fees with those of a few credit unions and banks in ${source.market}, laid out so it can go into an ALCO or board packet.`
      : `Following up once on my note last week. If it would help, I can send a short, source-linked example comparing ${source.institutionName} with a few ${source.market} institutions.`,
    "",
    "If competitive fee research sits with someone else on your team, I'd be glad to send it to them instead.",
  ];
  const finalFollowUp = [
    "One last note, and then I'll stop.",
    "",
    creditUnion
      ? `Is competitive fee research part of your role at ${source.institutionName}? If it sits with someone else, such as whoever prepares ALCO or board materials, I'd be grateful for their name. If it isn't something your team does, that's useful to know too.`
      : `Is competitive fee research part of your role at ${source.institutionName}? If it sits with someone else, I'd be grateful for their name. If it isn't something your team does, that's useful to know too.`,
  ];
  const email = [
    `Subject: ${subject}`,
    "",
    greetingName ? `Hi ${greetingName},` : "Hello,",
    "",
    ...(stage === 1 ? firstFollowUp : finalFollowUp),
    "",
    ...SIGN_OFF,
    "",
    "--",
    `Fee Insight LLC · ${OUTREACH_POSTAL_ADDRESS}`,
    `If you'd rather not hear from me again, reply "no thanks" and I won't follow up.`,
  ];
  const audit = [
    "--- For your audit. Not part of the email; delete before sending. ---",
    source.to ? `To: ${[source.to.name, source.to.title].filter(Boolean).join(", ") || "No name printed"} <${source.to.email}>` : "To: as the first email",
    ...(creditUnion ? ["Credit union: member wording (members, ALCO or board materials, peers as credit unions and banks)."] : []),
    stage === 1
      ? `Reply to the first email (queue item ${source.draftId}) so it threads. One final follow-up comes a week after this one if nothing is heard.`
      : `Reply in the same thread (first email: queue item ${source.draftId}). This is the last email to this institution; after it, stop.`,
  ];
  return { subject, title: `${source.institutionName}: ${stage === 1 ? "follow-up" : "final follow-up"}`, caption: [...email, "", ...audit].join("\n") };
}

export interface FollowUpRunResult {
  due: number;
  drafted: number;
  draftIds: number[];
}

/**
 * Follow-ups for first emails marked sent where James has recorded nothing since (no reply, call,
 * request or decline): the first at FOLLOW_UP_AFTER_DAYS, the final at FINAL_FOLLOW_UP_AFTER_DAYS
 * once the first was marked sent. Each at most once per institution, ever.
 */
export async function runOutreachFollowUps(input: { db?: SqlTag; runId: number | null; dryRun?: boolean; now?: Date }): Promise<FollowUpRunResult> {
  const db = input.db ?? sql;
  const result: FollowUpRunResult = { due: 0, drafted: 0, draftIds: [] };
  if (!(await contentSchemaReady(db)) || !(await journeySchemaReady(db))) return result;
  for (const stage of [1, 2] as const) await draftFollowUps(db, input, stage, result);
  return result;
}

async function draftFollowUps(
  db: SqlTag,
  input: { runId: number | null; dryRun?: boolean; now?: Date },
  stage: 1 | 2,
  result: FollowUpRunResult,
): Promise<void> {
  const now = input.now ?? new Date();
  const workflow = stage === 1 ? FOLLOW_UP_WORKFLOW : FINAL_FOLLOW_UP_WORKFLOW;
  const days = stage === 1 ? FOLLOW_UP_AFTER_DAYS : FINAL_FOLLOW_UP_AFTER_DAYS;
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  const firstSent = stage === 1;
  const rows = await db`
    SELECT d.id, d.facts, (SELECT s.charter_type FROM institution_sources s WHERE s.id = sent.institution_id) AS charter_type
      FROM content_drafts d
      JOIN outreach_outcomes sent ON sent.draft_id = d.id AND sent.outcome = 'sent'
     WHERE d.workflow = ${OUTREACH_WORKFLOW} AND d.kind = 'outreach_email' AND sent.created_at <= ${cutoff}
       AND NOT EXISTS (
         SELECT 1 FROM outreach_outcomes later
          WHERE later.institution_id = sent.institution_id AND later.outcome <> 'sent'
       )
       AND NOT EXISTS (
         SELECT 1 FROM content_drafts f
          WHERE f.workflow = ${workflow} AND f.subject_key = 'institution:' || sent.institution_id::text
       )
       AND (${firstSent}::boolean OR EXISTS (
         SELECT 1 FROM content_drafts f
           JOIN outreach_outcomes fs ON fs.draft_id = f.id AND fs.outcome = 'sent'
          WHERE f.workflow = ${FOLLOW_UP_WORKFLOW} AND f.subject_key = 'institution:' || sent.institution_id::text
       ))
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
      // Drafts carry the charter from Oct 9; older ones read it from the institution.
      charterType: typeof facts.charter_type === "string" ? facts.charter_type : row.charter_type == null ? null : String(row.charter_type),
    };
    if (input.dryRun) continue;
    const draft = buildFollowUpDraft(source, stage);
    const draftId = await insertContentDraft(
      {
        agent: "carnegie",
        kind: "outreach_email",
        workflow,
        channel: "email",
        subjectKey: `institution:${institutionId}`,
        title: draft.title,
        caption: draft.caption,
        facts: { institution_id: institutionId, institution_name: source.institutionName, market: source.market, charter_type: source.charterType ?? null, to: source.to, subject: source.subject ?? null, follows_draft: source.draftId, stage },
        asOf: now,
        agentRunId: input.runId,
      },
      db,
    );
    result.drafted++;
    result.draftIds.push(draftId);
  }
}
