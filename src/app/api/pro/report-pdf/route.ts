import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
/**
 * POST /api/pro/report-pdf
 *
 * Accepts: { report: ReportSummaryResponse, reportType: string }
 * Returns: PDF blob (application/pdf) as download
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
import type {
  AnalyzeResponse,
  ReportArtifactMetadata,
  ReportSummaryResponse,
} from "@/lib/hamilton/types";

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
    const analysis = body.analysis as AnalyzeResponse;
    const analysisFocus = (body.analysisFocus as string) || "Analysis";
    const institutionName = (body.institutionName as string) || undefined;

    if (!analysis || !analysis.hamiltonView) {
      return NextResponse.json({ error: "Invalid analysis data" }, { status: 400 });
    }

    try {
      const element = createElement(AnalysisPdfDocument, {
        analysis,
        analysisFocus,
        institutionName,
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
  const report = body.report as ReportSummaryResponse;
  const reportType = (body.reportType as string) || "report";
  const artifactMetadata =
    body.artifactMetadata && typeof body.artifactMetadata === "object"
      ? (body.artifactMetadata as ReportArtifactMetadata)
      : null;
  if (!report || !report.title) {
    return NextResponse.json({ error: "Invalid report data" }, { status: 400 });
  }

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
