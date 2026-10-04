import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
/**
 * POST /api/reports/email-gate
 * Lead capture + presigned PDF download URL.
 * Public endpoint — no authentication required.
 *
 * Security:
 *   T-16-04 — Email validated server-side before any DB operation
 *   T-16-05 — Slug validated against published_reports (is_public=true)
 *   T-16-06 — artifact_key never returned to client; presigned URL generated server-side
 *   T-16-07 — A returning lead is updated in place, never duplicated
 */

import { NextResponse } from "next/server";
import { getSql } from "@/lib/data-store/connection";
import { generatePresignedUrl } from "@/lib/report-engine/presign";

export const dynamic = "force-dynamic";

const REPORT_DOWNLOAD_SOURCE = "report_download";
const REPORT_DOWNLOAD_LEAD_NAME = "Report download";

// Strict email validation regex (T-16-04)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Row returned from the JOIN query
interface ReportArtifactRow {
  artifact_key: string | null;
}

async function handlePOST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { email, slug } = (body ?? {}) as Record<string, unknown>;

  // Validate email (T-16-04)
  if (typeof email !== "string" || !EMAIL_REGEX.test(email)) {
    return NextResponse.json(
      { error: "Invalid email address" },
      { status: 400 }
    );
  }

  // Validate slug is a non-empty string
  if (typeof slug !== "string" || slug.trim().length === 0) {
    return NextResponse.json(
      { error: "Missing or invalid slug" },
      { status: 400 }
    );
  }

  const sql = getSql();

  // Validate slug against published_reports (T-16-05) and fetch artifact_key
  let artifactKey: string | null = null;
  try {
    const rows = await sql<ReportArtifactRow[]>`
      SELECT rj.artifact_key
      FROM published_reports pr
      JOIN report_jobs rj ON pr.job_id = rj.id
      WHERE pr.slug = ${slug.trim()}
        AND pr.is_public = true
      LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    artifactKey = rows[0].artifact_key;
  } catch (err) {
    console.error("[/api/reports/email-gate] DB lookup error:", err);
    return NextResponse.json(
      { error: "Failed to look up report" },
      { status: 500 }
    );
  }

  // PDF not yet generated
  if (!artifactKey) {
    return NextResponse.json(
      { status: "pending", message: "Report PDF not yet available" },
      { status: 202 }
    );
  }

  // Store the lead in `leads` (the table the admin leads page reads); failure stays
  // non-blocking so the download still works. A returning lead gains this source and
  // report instead of being duplicated, matching /api/leads.
  try {
    const leadEmail = email.trim().toLowerCase();
    const useCase = `Downloaded report: ${slug.trim()}`;
    const existing = await sql<{ id: number }[]>`
      SELECT id FROM leads WHERE lower(email) = ${leadEmail} LIMIT 1`;
    if (existing.length > 0) {
      await sql`
        UPDATE leads SET
          source = CASE
            WHEN source IS NULL OR source = '' THEN ${REPORT_DOWNLOAD_SOURCE}
            WHEN ${REPORT_DOWNLOAD_SOURCE} = ANY(string_to_array(source, ',')) THEN source
            ELSE source || ',' || ${REPORT_DOWNLOAD_SOURCE}
          END,
          use_case = CASE
            WHEN use_case IS NULL OR use_case = '' THEN ${useCase}
            WHEN position(${useCase} in use_case) > 0 THEN use_case
            ELSE use_case || '; ' || ${useCase}
          END
        WHERE lower(email) = ${leadEmail}`;
    } else {
      await sql`
        INSERT INTO leads (name, email, use_case, source)
        VALUES (${REPORT_DOWNLOAD_LEAD_NAME}, ${leadEmail}, ${useCase}, ${REPORT_DOWNLOAD_SOURCE})`;
    }
  } catch (err) {
    console.error("[/api/reports/email-gate] Lead storage failed:", err);
  }

  // Generate presigned URL server-side — 1-hour TTL (T-16-06)
  let downloadUrl: string;
  try {
    downloadUrl = await generatePresignedUrl(artifactKey, 3600);
  } catch (err) {
    console.error("[/api/reports/email-gate] Presign error:", err);
    return NextResponse.json(
      { error: "Failed to generate download link" },
      { status: 500 }
    );
  }

  return NextResponse.json({ downloadUrl }, { status: 200 });
}

export const POST = withApiRoutePolicy("api.reports.email_gate", "POST", handlePOST);
