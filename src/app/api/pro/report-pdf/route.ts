import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
/**
 * POST /api/pro/report-pdf
 *
 * Accepts: { type: "report", reportId } or { type: "analysis", analysisId }
 * Returns: PDF blob (application/pdf) as download
 *
 * The PDF is rendered only from records loaded on the server: the user's own saved
 * report or analysis, or a published report. Client-supplied report content is never
 * rendered, so a branded PDF always reflects what Hamilton actually produced.
 *
 * Uses @react-pdf/renderer server-side only.
 * Listed in serverExternalPackages in next.config.ts.
 * Never imported in client bundle.
 */
import { canAccessPremium } from "@/lib/access";
import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { createElement } from "react";
import type { ReactElement, JSXElementConstructor } from "react";
import { getCurrentUser } from "@/lib/auth";
import { PdfDocument } from "@/components/hamilton/reports/PdfDocument";
import { AnalysisPdfDocument } from "@/components/hamilton/reports/AnalysisPdfDocument";
import { getHamiltonReportById } from "@/lib/hamilton/pro-tables";
import { loadAnalysisRecord } from "@/app/pro/(hamilton)/analyze/actions";
import { loadPublishedReport } from "@/app/pro/(hamilton)/reports/actions";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function recordId(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

async function handlePOST(req: NextRequest): Promise<NextResponse> {
  // Auth check
  let user = null;
  try {
    user = await getCurrentUser();
  } catch {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!canAccessPremium(user)) {
    return NextResponse.json({ error: "Pro subscription required" }, { status: 403 });
  }

  // Parse body and dispatch on type
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const pdfType = (body.type as string) || "report";

  // ── Analysis branch ──────────────────────────────────────────────────────
  if (pdfType === "analysis") {
    const analysisId = recordId(body.analysisId);
    if (!analysisId) {
      return NextResponse.json({ error: "analysisId is required" }, { status: 400 });
    }
    const record = await loadAnalysisRecord(analysisId);
    if (!record) {
      return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
    }
    const analysis = record.responseJson;
    const analysisFocus = record.analysisFocus || "Analysis";
    // Render frozen answer evidence and identity. Re-fetching today's institution
    // brief or active peer group would change the meaning of this saved answer.

    try {
      const element = createElement(AnalysisPdfDocument, {
        analysis,
        analysisFocus,
      }) as unknown as ReactElement<DocumentProps, string | JSXElementConstructor<unknown>>;
      const buffer = await renderToBuffer(element);
      const uint8 = new Uint8Array(buffer);

      const date = new Date().toISOString().split("T")[0];
      const filename = `hamilton-analysis-${date}.pdf`;

      return new NextResponse(uint8, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": uint8.byteLength.toString(),
          "Cache-Control": "no-store",
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `PDF generation failed: ${message}` },
        { status: 500 }
      );
    }
  }

  // ── Report branch (default) ──────────────────────────────────────────────
  const reportId = recordId(body.reportId);
  if (!reportId) {
    return NextResponse.json({ error: "reportId is required" }, { status: 400 });
  }
  const saved =
    (await getHamiltonReportById(reportId, user.id).catch(() => null)) ??
    (await loadPublishedReport(reportId).catch(() => null));
  if (!saved) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }
  const report = saved.report_json;
  const reportType = saved.report_type || "report";
  const artifactMetadata = saved.artifact_metadata ?? null;

  try {
    const element = createElement(PdfDocument, {
      report,
      reportType,
      artifactMetadata,
    }) as unknown as ReactElement<DocumentProps, string | JSXElementConstructor<unknown>>;
    const buffer = await renderToBuffer(element);
    const uint8 = new Uint8Array(buffer);

    const date = new Date().toISOString().split("T")[0];
    const filename = `hamilton-report-${date}.pdf`;

    return new NextResponse(uint8, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": uint8.byteLength.toString(),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `PDF generation failed: ${message}` },
      { status: 500 }
    );
  }
}

export const POST = withApiRoutePolicy("api.pro.report_pdf", "POST", handlePOST);
