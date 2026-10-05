# Runbook — Production Outage: Database Credential Failure

**Severity:** High — live site + all deploys down
**Root cause:** `password authentication failed for user "postgres"` — the `DATABASE_URL`
credential configured in Vercel (and in local `.env.local`) no longer matches the Supabase
database password. Began ~2026-06-06, which lines up with a password rotation that the env
vars never picked up.
**NOT related to** the four-directory consolidation (proven separately).

## Evidence

- Vercel build log (`vercel inspect … --logs`): prerender of `/` fails with
  `password authentication failed for user "postgres"`.
- `GET https://feeinsight.com/api/health` → `503 {"status":"error","message":"…password
  authentication failed for user \"postgres\""}` (runtime is down too, not just builds).
- Database host is reachable (the `db.rmhwbbjjctzfaqjyhomu.supabase.co` project is alive —
  its REST API responds 401) — the DB is healthy; only the credential is wrong.

### Also found: Supabase project mismatch (verify this)

- `DATABASE_URL` (in `.env`) → project **`rmhwbbjjctzfaqjyhomu`** (alive; password rejected).
- `NEXT_PUBLIC_SUPABASE_URL` (in `.env.local`) → project **`otagwdqirqkvkejutwvf`** (did not
  resolve/respond from here).

Your frontend and your Postgres connection point at **two different Supabase projects**.
Confirm which one is canonical before fixing the password — you may need to repoint
`DATABASE_URL` at the current project rather than just rotate the password.

## Fix (≈5 minutes — requires the DB password, which only you have)

1. **Get the current password.** Supabase Dashboard → project `rmhwbbjjctzfaqjyhomu` →
   Settings → Database → Database password (use **Reset database password** if it's unknown;
   note this rotates it everywhere).
2. **Copy the correct connection string.** In Supabase → **Connect** → **Transaction pooler**
   (port 6543 — the mode this app is documented to use). It looks like:
   ```
   postgresql://postgres.rmhwbbjjctzfaqjyhomu:[PASSWORD]@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```
   (Use the exact host Supabase shows — don't hand-build it.)
3. **Update Vercel env vars** (Vercel → the project serving `feeinsight.com` → Settings → Environment Variables)
   for **Production, Preview, and Development**:
   - `DATABASE_URL` → the transaction-pooler string above.
   - If present, `DATABASE_URL_SESSION` → the **Session pooler** string (port 5432); CLAUDE.md
     notes this is required for the LISTEN/NOTIFY agent messaging.
4. **Update local `.env.local`** with the same `DATABASE_URL` (it currently points at the
   direct `db.…supabase.co:5432`, which isn't reachable for builds).
5. **Redeploy** — push any commit, or Vercel → Deployments → Redeploy.

## Verify (I can run these for you — just say "verify")

- `curl -s https://feeinsight.com/api/health` → expect `{"status":"ok", …}`
- Latest Vercel deployment shows **Ready**, not Error.
- `npm run build` locally succeeds with the corrected `.env.local`.

## Follow-ups

- If the password may have leaked, rotate it (step 1's reset) and update every consumer.
- Confirm no other service/cron uses a stale copy of the old credential.

## Hardening already in place (PR #17)

The build no longer hard-crashes when the DB is unreachable — the homepage, the Hamilton
briefing, and `sitemap.xml` now degrade to empty/"unavailable" states instead of aborting
the build. So a future credential lapse will show "data unavailable" rather than taking
down every deployment at build time. **This is resilience, not a substitute for the fix
above** — runtime data still needs valid credentials.
