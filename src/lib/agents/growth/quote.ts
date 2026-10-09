import { REPORT_INCLUDES, REPORT_OFFER } from "@/lib/constants";
import { sql } from "@/lib/data-store/connection";
import { contentSchemaReady, insertContentDraft, recentSubjects } from "@/lib/data-store/content-drafts";
import { leadQualifiedReady } from "@/lib/data-store/lead-qualified";
import { isTestLead } from "@/lib/leads/lead-status";
import { formatUsd } from "@/lib/leads/report-payment";
import { annualMonthsFree, PRO_TIERS, proTier, tierForAssets, tierPriceLabel, type ProTier } from "@/lib/pro-tiers";
import { OUTREACH_POSTAL_ADDRESS } from "./outreach";

/**
 * CARNEGIE's quote drafts (BUILD-PLAN 2.25). For each lead James marked qualified on
 * /admin/leads, one quote email lands in the growth queue (`content_drafts`, kind `pitch`) for
 * him to review in /admin/growth and send himself. Nothing sends.
 *
 * Every price comes from the code that prices the site: the Pro tiers on /subscribe
 * (`PRO_TIERS`) and the institution report's lowest quote (`REPORT_OFFER.fromPriceUsd`). When
 * James has typed a quote for the lead's report request (`quote_amount_cents`), the draft uses
 * that amount instead. No price is invented, no delivery time is promised, and the email gives
 * no fee advice. Free step: no model call.
 */

type SqlTag = typeof sql;

export const QUOTE_WORKFLOW = "quote";
/** A lead is drafted once; a skipped draft is not proposed again within this window. */
export const QUOTE_REPEAT_DAYS = 3650;
export const QUOTE_MAX_PER_RUN = 25;

const SIGN_OFF = ["Best,", "James", "Founder, Fee Insight"];
const FOOTER = ["", "--", `Fee Insight LLC · ${OUTREACH_POSTAL_ADDRESS}`, `If you'd rather not hear from me again, reply "no thanks" and I won't follow up.`];

export interface QuoteLead {
  id: number;
  name: string;
  email: string;
  company: string | null;
  source: string | null;
  qualifiedAt: string;
  qualifiedBy: string | null;
  /** James's typed quote for the report request, in cents; null when none. */
  quoteCents: number | null;
  institutionId: number | null;
  institutionName: string | null;
  /** Total assets in thousands of dollars (call report units); null when unknown. */
  assetsThousands: number | null;
}

export interface QuoteDraft {
  subject: string;
  title: string;
  caption: string;
  tier: ProTier | null;
  reportPrice: { cents: number; quoted: boolean };
}

function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return /^[A-Za-z][A-Za-z'-]*$/.test(first) ? first : "there";
}

function proLine(tier: ProTier): string {
  const def = proTier(tier);
  return `${def.assetsLabel}: ${tierPriceLabel(tier, "monthly")} or ${tierPriceLabel(tier, "annual")} (${annualMonthsFree(tier)} months free)`;
}

/** The quote email and its audit block for one qualified lead. Pure. */
export function buildQuoteDraft(lead: QuoteLead): QuoteDraft {
  const organization = lead.institutionName ?? lead.company;
  const tier = tierForAssets(lead.assetsThousands);
  const quoted = lead.quoteCents !== null && lead.quoteCents > 0;
  const reportCents = quoted ? (lead.quoteCents as number) : REPORT_OFFER.fromPriceUsd * 100;
  const subject = organization ? `Fee Insight pricing for ${organization}` : "Fee Insight pricing";

  const reportLines = [
    `${REPORT_OFFER.name} (one-off)`,
    quoted
      ? `- ${formatUsd(reportCents)}${lead.institutionName ? ` for ${lead.institutionName} against its local competitors` : ""}.`
      : `- From ${formatUsd(reportCents)}. It is built for one institution against named competitors in its market, so I confirm the exact price once we agree the scope.`,
    ...REPORT_INCLUDES.map((line) => `- ${line}`),
    `- ${REPORT_OFFER.refreshLabel}`,
  ];
  const proLines = [
    "Fee Insight Pro (subscription to the Hamilton workspace, for up to 5 people)",
    ...(tier ? [`- ${proLine(tier)}`] : PRO_TIERS.map((def) => `- ${proLine(def.key)}`)),
    "- Every tier has the same features; the price follows the institution's total assets.",
  ];

  const email = [
    `Subject: ${subject}`,
    "",
    `Hi ${firstName(lead.name)},`,
    "",
    `Thank you for your interest in Fee Insight${organization ? ` for ${organization}` : ""}. Here is what each option costs today.`,
    "",
    ...reportLines,
    "",
    ...proLines,
    "",
    "If either fits, reply to this email and I'll send a secure payment link.",
    "",
    ...SIGN_OFF,
    ...FOOTER,
  ];
  const audit = [
    "--- For your review. Not part of the email; delete before sending. ---",
    `To: ${lead.name} <${lead.email}>${lead.company ? `, ${lead.company}` : ""}`,
    `Lead ${lead.id}, source ${lead.source ?? "unknown"}; marked qualified ${lead.qualifiedAt.slice(0, 16).replace("T", " ")} UTC${lead.qualifiedBy ? ` by ${lead.qualifiedBy}` : ""}.`,
    quoted
      ? `Report price: your saved quote on /admin/leads (${formatUsd(reportCents)}).`
      : `Report price: no quote saved for this lead, so the email states the lowest price (REPORT_OFFER.fromPriceUsd, ${formatUsd(reportCents)}).`,
    tier
      ? `Pro tier: ${proTier(tier).assetsLabel}, from institution ${lead.institutionId}'s total assets (PRO_TIERS, as on /subscribe).`
      : "Pro tier: the institution's assets are not known, so the email lists all three tiers (PRO_TIERS, as on /subscribe).",
    "Before sending: fill in the postal address, check the prices still match /subscribe, and confirm the scope you discussed.",
  ];

  return {
    subject,
    title: `Quote: ${organization ?? lead.name}`,
    caption: [...email, "", ...audit].join("\n"),
    tier,
    reportPrice: { cents: reportCents, quoted },
  };
}

export interface QuoteRunResult {
  schemaReady: boolean;
  dryRun: boolean;
  qualified: number;
  alreadyDrafted: number;
  skipped: Array<{ leadId: number; reason: string }>;
  drafted: number;
  draftIds: number[];
}

async function loadQualifiedLeads(db: SqlTag): Promise<QuoteLead[]> {
  // Payment columns (migration 20270110000003) are read through to_jsonb, so a missing column reads as null.
  const rows = await db`
    SELECT l.id, l.name, l.email, l.company, l.source, l.qualified_at, l.qualified_by,
           l.email_unsubscribed_at,
           to_jsonb(l)->>'quote_amount_cents' AS quote_cents,
           to_jsonb(l)->>'paid_at' AS paid_at,
           s.id AS institution_id, s.institution_name, s.asset_size
      FROM leads l
      LEFT JOIN institution_sources s ON s.id = NULLIF(to_jsonb(l)->>'quote_institution_id', '')::bigint
     WHERE l.qualified_at IS NOT NULL
     ORDER BY l.qualified_at, l.id
     LIMIT 200`;
  return rows
    .filter((row) => !row.paid_at && !row.email_unsubscribed_at)
    .map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      email: String(row.email),
      company: row.company ? String(row.company) : null,
      source: row.source ? String(row.source) : null,
      qualifiedAt: new Date(row.qualified_at as string).toISOString(),
      qualifiedBy: row.qualified_by ? String(row.qualified_by) : null,
      quoteCents: row.quote_cents === null || row.quote_cents === undefined ? null : Number(row.quote_cents),
      institutionId: row.institution_id === null || row.institution_id === undefined ? null : Number(row.institution_id),
      institutionName: row.institution_name ? String(row.institution_name) : null,
      assetsThousands: row.asset_size === null || row.asset_size === undefined ? null : Number(row.asset_size),
    }));
}

/** Drafts one quote per qualified, unpaid lead not drafted before. A dry run counts and writes nothing. */
export async function runQuoteDrafts(input: { db?: SqlTag; runId: number | null; dryRun?: boolean; now?: Date }): Promise<QuoteRunResult> {
  const db = input.db ?? sql;
  const dryRun = input.dryRun ?? false;
  const result: QuoteRunResult = { schemaReady: false, dryRun, qualified: 0, alreadyDrafted: 0, skipped: [], drafted: 0, draftIds: [] };
  if (!(await contentSchemaReady(db)) || !(await leadQualifiedReady(db))) return result;
  result.schemaReady = true;
  const leads = await loadQualifiedLeads(db);
  result.qualified = leads.length;
  const drafted = await recentSubjects(QUOTE_WORKFLOW, QUOTE_REPEAT_DAYS, db);
  for (const lead of leads) {
    const subjectKey = `lead:${lead.id}`;
    if (drafted.has(subjectKey)) {
      result.alreadyDrafted++;
      continue;
    }
    if (isTestLead(lead)) {
      result.skipped.push({ leadId: lead.id, reason: "test lead" });
      continue;
    }
    if (result.drafted >= QUOTE_MAX_PER_RUN) break;
    const draft = buildQuoteDraft(lead);
    result.drafted++;
    if (dryRun) continue;
    const draftId = await insertContentDraft(
      {
        agent: "carnegie",
        kind: "pitch",
        workflow: QUOTE_WORKFLOW,
        channel: "email",
        subjectKey,
        title: draft.title,
        caption: draft.caption,
        facts: {
          lead_id: lead.id,
          institution_id: lead.institutionId,
          institution_name: lead.institutionName,
          subject: draft.subject,
          pro_tier: draft.tier,
          report_price_cents: draft.reportPrice.cents,
          report_price_quoted: draft.reportPrice.quoted,
          qualified_at: lead.qualifiedAt,
          qualified_by: lead.qualifiedBy,
          source: "leads (qualified on /admin/leads), PRO_TIERS, REPORT_OFFER",
        },
        asOf: input.now ?? new Date(),
        agentRunId: input.runId,
      },
      db,
    );
    result.draftIds.push(draftId);
  }
  return result;
}

export function summarizeQuoteDrafts(result: QuoteRunResult): string {
  if (!result.schemaReady) return "No quotes: the queue or the leads' qualified columns are not there yet.";
  if (result.qualified === 0) return "No lead is marked qualified, so there is no quote to draft.";
  const verb = result.dryRun ? "Would draft" : "Drafted";
  const parts = [`${verb} ${result.drafted} quote email${result.drafted === 1 ? "" : "s"} for James to review and send himself`];
  if (result.alreadyDrafted) parts.push(`${result.alreadyDrafted} already drafted`);
  if (result.skipped.length) parts.push(`${result.skipped.length} skipped`);
  return `${parts.join("; ")} (${result.qualified} qualified, unpaid).`;
}
