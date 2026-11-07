import { NextResponse } from 'next/server';
import { sql } from '@/lib/data-store/connection';
import { withCohortReadTimeout } from '@/lib/agents/deming/fixed-cohort-history';
import { getCurrentUser } from '@/lib/auth';
import { withApiRoutePolicy } from '@/lib/api-hardening/route-wrapper';
import { parseEngineeringEvidenceRequest, readEngineeringRuntimeEvidence } from '@/lib/engineering-verification/runtime';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

async function handleGET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let query;
  try { query = parseEngineeringEvidenceRequest(new URL(request.url).searchParams); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid query' }, { status: 400 }); }
  try {
    const evidence = await withCohortReadTimeout(sql, scope => readEngineeringRuntimeEvidence(query, scope), 10_000);
    return NextResponse.json(evidence, { status: evidence.problems.length ? 503 : 200, headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ schemaVersion: 1, request: query, problems: ['Runtime evidence read unavailable or exceeded its 10 second query budget'] }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
export const GET = withApiRoutePolicy('api.admin.engineering_verification', 'GET', handleGET);
