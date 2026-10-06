/**
 * Quote and payment state of an institution report request (leads row). The payment
 * columns come from migration 20270110000003; until it has run they read as missing,
 * so the leads page and the pay page say "not quoted" instead of failing.
 */
import { sql } from "./connection";
import type { CustomReportMarketData } from "./custom-report-market";

export interface ReportPaymentLead {
  id: number;
  name: string;
  email: string;
  company: string | null;
  source: string | null;
  useCase: string | null;
  status: string;
  /** False until the payment columns exist on leads. */
  paymentColumns: boolean;
  quoteCents: number | null;
  quoteInstitutionId: number | null;
  quoteSentAt: string | null;
  paidAt: string | null;
  checkoutSessionId: string | null;
}

function toPositiveInt(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
}

function toText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Reads a lead's payment fields from to_jsonb(leads), so a missing column reads as null. */
export function paymentFieldsOf(row: Record<string, unknown> | null | undefined) {
  const fields = row ?? {};
  return {
    paymentColumns: "quote_amount_cents" in fields,
    quoteCents: toPositiveInt(fields.quote_amount_cents),
    quoteInstitutionId: toPositiveInt(fields.quote_institution_id),
    quoteSentAt: toText(fields.quote_sent_at),
    paidAt: toText(fields.paid_at),
    checkoutSessionId: toText(fields.stripe_checkout_session_id),
  };
}

export async function getReportPaymentLead(leadId: number): Promise<ReportPaymentLead | null> {
  const [row] = await sql<
    { id: string | number; name: string; email: string; company: string | null; source: string | null; use_case: string | null; status: string | null; fields: Record<string, unknown> }[]
  >`SELECT id, name, email, company, source, use_case, status, to_jsonb(leads) AS fields FROM leads WHERE id = ${leadId}`;
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    company: row.company,
    source: row.source,
    useCase: row.use_case,
    status: row.status || "new",
    ...paymentFieldsOf(row.fields),
  };
}

export async function getInstitutionLabel(institutionId: number): Promise<{ id: number; name: string; city: string | null; stateCode: string | null } | null> {
  const [row] = await sql<{ id: string | number; institution_name: string; city: string | null; state_code: string | null }[]>`
    SELECT id, institution_name, city, state_code FROM institution_sources WHERE id = ${institutionId}`;
  return row ? { id: Number(row.id), name: row.institution_name, city: row.city, stateCode: row.state_code } : null;
}

/** Saves James's quote. A paid request keeps its price. Returns false when nothing changed. */
export async function saveReportQuote(leadId: number, cents: number, institutionId: number): Promise<boolean> {
  const rows = await sql`
    UPDATE leads
    SET quote_amount_cents = ${cents}, quote_institution_id = ${institutionId}, status = 'quoted'
    WHERE id = ${leadId} AND paid_at IS NULL
    RETURNING id`;
  return rows.length > 0;
}

export async function markQuoteSent(leadId: number): Promise<void> {
  await sql`UPDATE leads SET quote_sent_at = NOW() WHERE id = ${leadId}`;
}

/** A quoted report whose market went thin before payment: back to James as owed a reply. */
export async function flagQuoteNotReady(leadId: number): Promise<void> {
  await sql`UPDATE leads SET status = 'needs_reply' WHERE id = ${leadId} AND paid_at IS NULL AND status = 'quoted'`;
}

/**
 * Saves the report data the buyer is about to pay for (migration 20270110000005). Never
 * throws: before the migration has run the save is skipped and logged, and checkout goes on.
 */
export async function saveReportSnapshot(leadId: number, data: CustomReportMarketData): Promise<void> {
  try {
    await sql`
      UPDATE leads SET report_snapshot = ${sql.json(JSON.parse(JSON.stringify(data)))}, report_snapshot_at = NOW()
      WHERE id = ${leadId} AND paid_at IS NULL`;
  } catch (error) {
    console.error("[report-payment] snapshot not saved", {
      leadId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * The newest saved report data for an institution from a paid request, or null. Read through
 * to_jsonb so it returns null (not an error) before migration 20270110000005 has run.
 */
export async function getPaidReportSnapshot(
  institutionId: number,
): Promise<{ data: CustomReportMarketData; savedAt: string } | null> {
  const [row] = await sql<{ snapshot: CustomReportMarketData | null; saved_at: string | null }[]>`
    SELECT to_jsonb(leads)->'report_snapshot' AS snapshot, to_jsonb(leads)->>'report_snapshot_at' AS saved_at
    FROM leads
    WHERE to_jsonb(leads)->>'quote_institution_id' = ${String(institutionId)}
      AND to_jsonb(leads)->>'paid_at' IS NOT NULL
      AND jsonb_typeof(to_jsonb(leads)->'report_snapshot') = 'object'
    ORDER BY to_jsonb(leads)->>'paid_at' DESC
    LIMIT 1`;
  if (!row?.snapshot || !row.saved_at) return null;
  return { data: row.snapshot, savedAt: row.saved_at };
}

export async function saveCheckoutSession(leadId: number, sessionId: string): Promise<void> {
  await sql`UPDATE leads SET stripe_checkout_session_id = ${sessionId} WHERE id = ${leadId} AND paid_at IS NULL`;
}
