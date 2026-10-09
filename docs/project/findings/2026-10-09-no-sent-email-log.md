# 2026-10-09: no sent-email log
**What happened:** James's admin audit (finding 7): the Publishing room's "Emails sent" said "Resend answered 401".
The page read Resend's `GET /emails` live, and the production `RESEND_API_KEY` is a sending-only key, so the
list could not be read. Postgres had no table recording sends, so the app could not say what it had sent,
whether Resend accepted it, or whether it was delivered.
**Cause:** sending was logged nowhere on our side; the only history lived in Resend behind a read-access key.
**Fix:** this PR. Migration `20270110000034_email_send_log.sql` adds `email_send_log` (new table, no data change).
`sendResendEmail` (`src/lib/email/resend.ts`) records each attempt (sent / failed / not_configured, Resend id,
error) best effort: a failed log write is logged and never changes the send. `/api/webhooks/resend` verifies
the Svix signature (`RESEND_WEBHOOK_SECRET`) and stamps Resend's latest `email.*` event on the row. The
Publishing room reads the log and shows configured, send accepted and delivered separately; the live Resend
list is gone, so the sending-only key stays least privilege.
**Pending:** James registers the Resend webhook (URL `/api/webhooks/resend`, `email.*` events) and sets
`RESEND_WEBHOOK_SECRET`. Until then the route answers 503 and "Delivered" says no events have arrived.
Sends before the migration are not in the log.
**Lesson:** an outgoing side effect needs its own record in Postgres; don't rely on a provider's read API
that needs broader credentials than sending.
