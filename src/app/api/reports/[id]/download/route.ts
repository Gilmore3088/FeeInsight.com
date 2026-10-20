import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
/**
 * GET /api/reports/[id]/download
 * Phase 13-03: D-09 implementation
 *
 * Authoritative download flow. Verifies auth and ownership, then returns a
 * 302 redirect to a short-TTL R2 presigned URL. URL is generated fresh —
 * never stored in the DB (per D-04).
 *
 * Users click "Download" → this route → 302 → R2 signed URL → PDF.
 *
 * Decision refs: D-03, D-04, D-09 (see 13-CONTEXT.md)
 * Threat refs: T-13-12
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSql } from '@/lib/data-store/connection';
import { generatePresignedUrl } from '@/lib/report-engine/presign';
import type { ReportJob } from '@/lib/report-engine/types';
import { canReadReportJob } from '@/lib/report-access';

export const dynamic = 'force-dynamic';

// TTL per D-04: 1 hour
const PRESIGNED_TTL_SECONDS = 3600;

async function handleGET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // T-13-12: auth required before any processing
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

  // T-13-12: ownership guard (#1999): the owner reads their own job with or without a
  // subscription (read-only access to reports already paid for); an admin reads any job.
  if (!canReadReportJob(user, job)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 409 when report is not yet complete (not 404 — job exists, just not ready)
  if (job.status !== 'complete') {
    return NextResponse.json(
      { error: 'Report not ready', status: job.status },
      { status: 409 },
    );
  }

  // Data integrity check — complete without artifact_key is unexpected
  if (!job.artifact_key) {
    console.error(
      `[reports/download] Job ${job.id} is complete but has no artifact_key — data integrity issue`,
    );
    return NextResponse.json(
      { error: 'Report artifact missing' },
      { status: 500 },
    );
  }

  const presignedUrl = await generatePresignedUrl(job.artifact_key, PRESIGNED_TTL_SECONDS);

  // 302 redirect — client follows to R2 directly (not 200 with URL in body)
  return NextResponse.redirect(presignedUrl, { status: 302 });
}

export const GET = withApiRoutePolicy("api.reports.download", "GET", handleGET);
