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

  await withTransaction(async (tx) => {
    if (isTerminal) {
      await tx`
        UPDATE report_jobs
           SET status = ${status},
               artifact_key = ${body.artifact_key ?? null},
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
      await tx`
        UPDATE report_jobs SET status = ${status}
         WHERE id = ${id}
           AND status NOT IN ('cancel_requested', 'cancelled')
      `;
      await tx`
        UPDATE agent_runs
           SET status = 'running', started_at = COALESCE(started_at, NOW()),
               updated_at = NOW()
         WHERE id = (SELECT agent_run_id FROM report_jobs WHERE id = ${id})
           AND status IN ('queued', 'running')
      `;
    }
  });

  return NextResponse.json({ ok: true });
}

export const GET = withApiRoutePolicy("api.reports.status", "GET", handleGET);
export const PATCH = withApiRoutePolicy("api.reports.status", "PATCH", handlePATCH);
