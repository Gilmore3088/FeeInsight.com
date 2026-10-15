import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
/**
 * GET /api/reports/[id]/status
 * Phase 13-03: D-08 implementation
 *
 * Polls job state. Returns presigned_url only when status='complete' and
 * artifact_key is set — generated fresh on every call (never stored, per D-04).
 *
 * Ownership rule: user sees their own jobs; admin can see cron jobs (user_id IS NULL).
 *
 * Decision refs: D-04, D-08 (see 13-CONTEXT.md)
 * Threat refs: T-13-11
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSql, withTransaction } from '@/lib/data-store/connection';
import { generatePresignedUrl } from '@/lib/report-engine/presign';
import type { ReportJob } from '@/lib/report-engine/types';
import { isProviderLimitError } from '@/lib/ai-provider';
import { HAMILTON_PAUSED_MESSAGE } from '@/lib/hamilton/provider-paused';
import { reconciliationTiesOut } from '@/lib/report-engine/reconcile';

export const dynamic = 'force-dynamic';

// TTL per D-04: 1 hour
const PRESIGNED_TTL_SECONDS = 3600;

async function handleGET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // T-13-11: auth required before any DB query
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Next.js 15: params is a Promise — must await
  const { id } = await params;

  const sql = getSql();
  const rows = await sql<ReportJob[]>`
    SELECT * FROM report_jobs WHERE id = ${id} LIMIT 1
  `;

  const job = rows[0];
  if (!job) {
    return NextResponse.json({ error: 'Report job not found' }, { status: 404 });
  }

  // T-13-11: ownership guard
  // Both user.id and job.user_id are integers — compare with Number() for safety
  const isOwner = Number(job.user_id) === Number(user.id);
  const isAdminViewingCronJob = user.role === 'admin' && job.user_id == null;
  const isAdmin = user.role === 'admin';
  if (!isOwner && !isAdminViewingCronJob && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Generate presigned URL only when complete — per D-04 "generate at download time"
  let presignedUrl: string | null = null;
  if (job.status === 'complete' && job.artifact_key) {
    try {
      presignedUrl = await generatePresignedUrl(job.artifact_key, PRESIGNED_TTL_SECONDS);
    } catch (err) {
      console.error('[reports/status] Presign failed:', err instanceof Error ? err.message : err);
      // Don't crash the status endpoint — return null URL with a note
    }
  }

  return NextResponse.json({
    id: job.id,
    status: job.status,
    report_type: job.report_type,
    created_at: job.created_at,
    completed_at: job.completed_at,
    // A provider usage/billing refusal reads as the paused line; the job row keeps the detail.
    error: job.error && isProviderLimitError(job.error) ? HAMILTON_PAUSED_MESSAGE : job.error ?? null,
    presigned_url: presignedUrl,
  });
}

/**
 * PATCH /api/reports/[id]/status
 * Internal endpoint for the report backend to update job status via HTTP.
 * Auth: X-Internal-Secret header (same as assemble endpoint).
 *
 * Body: { status, artifact_key?, error? }
 *
 * `complete` is accepted only for a job whose saved reconciliation tied out (#1249): the
 * report-reconcile step is what completes a report (#1066), and a complete job is
 * downloadable, so this endpoint must not skip that check. Anything else gets a 409.
 *
 * `assembling` and `rendering` move only an open job (pending, assembling, rendering); a
 * complete, failed or cancelled job gets a 409 and is left as it is (#1271).
 */
const VALID_STATUSES = new Set(['assembling', 'rendering', 'complete', 'failed']);

async function handlePATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const secret = process.env.REPORT_INTERNAL_SECRET;
  const headerSecret = request.headers.get('x-internal-secret');
  if (!secret || secret.length === 0 || headerSecret !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  let body: { status?: string; artifact_key?: string; error?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.status || !VALID_STATUSES.has(body.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const status = body.status;
  const isTerminal = status === 'complete' || status === 'failed';
  const runStatus = status === 'complete'
    ? 'completed'
    : status === 'failed'
      ? 'failed'
      : 'running';

  const refusal = await withTransaction(async (tx): Promise<{ code: number; error: string } | null> => {
    if (status === 'complete') {
      const [job] = await tx<Array<{ data_manifest: unknown }>>`
        SELECT data_manifest FROM report_jobs WHERE id = ${id} FOR UPDATE
      `;
      if (!job) return { code: 404, error: 'Report job not found' };
      if (!reconciliationTiesOut(job.data_manifest)) {
        return {
          code: 409,
          error:
            'Report job has no reconciliation that tied out to live data, so it cannot be marked complete. ' +
            'The report-reconcile step completes a report; retry the report to render and reconcile it.',
        };
      }
    }
    if (isTerminal) {
      await tx`
        UPDATE report_jobs
           SET status = ${status},
               -- A PATCH without a key keeps the saved one (#1259), so a 'failed' PATCH
               -- never clears the key of a report that was already rendered.
               artifact_key = COALESCE(${body.artifact_key ?? null}, artifact_key),
               error = ${body.error ?? null},
               completed_at = NOW()
         WHERE id = ${id}
           AND status IN ('pending', 'assembling', 'rendering')
      `;
      await tx`
        UPDATE agent_runs
           SET status = ${runStatus},
               error_summary = ${body.error ?? null},
               summary = ${status === 'complete' ? 'Report generated successfully' : null},
               completed_at = NOW(), updated_at = NOW()
         WHERE id = (SELECT agent_run_id FROM report_jobs WHERE id = ${id})
           AND status IN ('queued', 'running')
      `;
    } else {
      // Only an open job moves (#1271): a finished (complete, failed) or cancelled job is
      // never reopened, and its agent run is left as it is.
      const moved = await tx<Array<{ id: string }>>`
        UPDATE report_jobs SET status = ${status}
         WHERE id = ${id}
           AND status IN ('pending', 'assembling', 'rendering')
         RETURNING id
      `;
      if (moved.length === 0) {
        const [job] = await tx<Array<{ status: string }>>`
          SELECT status FROM report_jobs WHERE id = ${id}
        `;
        if (!job) return { code: 404, error: 'Report job not found' };
        return {
          code: 409,
          error: `Report job is ${job.status}, so it cannot be moved back to ${status}.`,
        };
      }
      await tx`
        UPDATE agent_runs
           SET status = 'running', started_at = COALESCE(started_at, NOW()),
               updated_at = NOW()
         WHERE id = (SELECT agent_run_id FROM report_jobs WHERE id = ${id})
           AND status IN ('queued', 'running')
      `;
    }
    return null;
  });

  if (refusal) {
    return NextResponse.json({ error: refusal.error }, { status: refusal.code });
  }
  return NextResponse.json({ ok: true });
}

export const GET = withApiRoutePolicy("api.reports.status", "GET", handleGET);
export const PATCH = withApiRoutePolicy("api.reports.status", "PATCH", handlePATCH);
