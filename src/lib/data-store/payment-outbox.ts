import { randomUUID } from "node:crypto";
import { sql, withTransaction } from "./connection";
import type { ResendMessage } from "@/lib/email/resend";

export type PaymentEmailKind = "welcome" | "report_customer" | "report_admin" | "duplicate_admin" | "refund_admin";
export interface PaymentEmailJob {
  id: string; event_id: string; kind: PaymentEmailKind; lead_id: number | null;
  message: ResendMessage; state: "pending" | "sending" | "accepted" | "review" | "cancelled" | "resolved";
  attempts: number; first_attempt_at: string | Date | null; lease_token: string | null;
  last_error: string | null; provider_id: string | null; created_at: string | Date;
}
export async function enqueuePaymentEmail(tx: typeof sql, input: {
  eventId: string; key: string; kind: PaymentEmailKind; leadId?: number; message: ResendMessage; reviewReason?: string;
}): Promise<void> {
  const id = randomUUID();
  const message = { ...input.message, idempotencyKey: `payment-email/${id}` };
  await tx`INSERT INTO payment_email_outbox(id,event_id,dedupe_key,kind,lead_id,message,state,last_error)
    VALUES (${id},${input.eventId},${input.key},${input.kind},${input.leadId ?? null},${JSON.stringify(message)}::jsonb,
      ${input.reviewReason ? "review" : "pending"},${input.reviewReason ?? null})
    ON CONFLICT (dedupe_key) DO NOTHING`;
}

/** Reclaim only expired leases. Every receipt update must prove ownership of the lease. */
export async function claimPaymentEmail(eventId: string | null, id: string | null, configuredFrom: string | null): Promise<PaymentEmailJob | null> {
  return withTransaction(async (tx) => {
    const [row] = await tx<PaymentEmailJob[]>`
      SELECT * FROM payment_email_outbox
      WHERE (${eventId}::text IS NULL OR event_id = ${eventId}) AND (${id}::uuid IS NULL OR id = ${id}::uuid)
        AND ((state = 'pending' AND next_attempt_at <= now()) OR (state = 'sending' AND lease_until <= now()))
      ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!row) return null;
    if (row.first_attempt_at && (Date.now() - new Date(row.first_attempt_at).getTime() >= 23 * 3600000 || row.attempts >= 6)) {
      await tx`UPDATE payment_email_outbox SET state='review',lease_token=NULL,lease_until=NULL,
        last_error='Retry limit or safe provider deduplication window reached. Reconcile provider history before any manual resend.',updated_at=now()
        WHERE id=${row.id}`;
      return null;
    }
    if (row.kind === "report_customer" && row.lead_id) {
      const [lead] = await tx`SELECT paid_at, refunded_at FROM leads WHERE id=${row.lead_id}`;
      if (!lead?.paid_at || lead.refunded_at) {
        await tx`UPDATE payment_email_outbox SET state='cancelled',lease_token=NULL,lease_until=NULL,
          last_error='Report payment is missing or refunded; customer delivery cancelled.',updated_at=now() WHERE id=${row.id}`;
        return null;
      }
    }
    // A missing sender/key is not an attempt. Persist the sender before the first send,
    // then keep the exact envelope even if configuration changes during a retry.
    if (!configuredFrom) {
      await tx`UPDATE payment_email_outbox SET state='pending',lease_token=NULL,lease_until=NULL,
        next_attempt_at=now()+interval '30 seconds',last_error='Transactional email is not configured.',updated_at=now() WHERE id=${row.id}`;
      return null;
    }
    const message = row.first_attempt_at ? row.message : { ...row.message, from: row.message.from || configuredFrom };
    const token = randomUUID();
    const [claimed] = await tx<PaymentEmailJob[]>`
      UPDATE payment_email_outbox SET state='sending',message=${JSON.stringify(message)}::jsonb,
        attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,now()),lease_token=${token},
        lease_until=now()+interval '90 seconds',updated_at=now()
      WHERE id=${row.id} RETURNING *`;
    return claimed;
  });
}
export async function finishPaymentEmail(job: PaymentEmailJob, result: { providerId: string | null } | { error: string }): Promise<boolean> {
  const accepted = "providerId" in result;
  const terminal = !accepted && job.attempts >= 6;
  const delay = Math.min(3600, 30 * 2 ** Math.max(0, job.attempts - 1));
  const rows = await sql`UPDATE payment_email_outbox
    SET state=${accepted ? "accepted" : terminal ? "review" : "pending"},lease_token=NULL,lease_until=NULL,
      next_attempt_at=now()+make_interval(secs=>${delay}),provider_id=${accepted ? result.providerId : null},
      last_error=${accepted ? null : result.error.slice(0,500)},updated_at=now()
    WHERE id=${job.id} AND state='sending' AND lease_token=${job.lease_token}::uuid RETURNING id`;
  return rows.length === 1;
}
export async function paymentEmailStatus(eventId: string) {
  const [row] = await sql<{ pending: number; review: number }[]>`
    SELECT count(*) FILTER (WHERE state IN ('pending','sending'))::int AS pending,
      count(*) FILTER (WHERE state='review')::int AS review FROM payment_email_outbox WHERE event_id=${eventId}`;
  return row ?? { pending: 0, review: 0 };
}
export async function listPaymentEmails(): Promise<PaymentEmailJob[]> {
  return sql<PaymentEmailJob[]>`SELECT * FROM payment_email_outbox
    ORDER BY CASE WHEN state='review' THEN 0 WHEN state IN ('pending','sending') THEN 1 ELSE 2 END, created_at DESC LIMIT 50`;
}
export async function resolvePaymentEmail(id: string, userId: number, note: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isSafeInteger(userId) || userId < 1 || note.trim().length < 12 || note.length > 1000) {
    throw new Error("A valid job and an explicit reconciliation note are required");
  }
  await sql`UPDATE payment_email_outbox SET state='resolved',resolved_by=${userId},resolution_note=${note.trim()},updated_at=now()
    WHERE id=${id}::uuid AND state='review'`;
}
