import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { loadFeeWorkspace } from "@/lib/hamilton/fee-workspace-data";
import { parseLayer } from "@/lib/hamilton/research-layers";
import {
  EXPORT_LIMIT_MESSAGE, EXPORT_UNAVAILABLE_MESSAGE, HAMILTON_EXPORT_MAX_ROWS, capExportRows, checkExportAllowance, recordExport,
} from "@/lib/hamilton/export-limits";
import { ownFeeList, type SeveralFees } from "@/lib/own-fee";

export const dynamic = "force-dynamic";

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The institutions behind a Research or Model comparison, with its value, publish date and the
 * fee schedule it came from, so a client can check any figure Hamilton shows. One file holds at
 * most HAMILTON_EXPORT_MAX_ROWS rows and an account downloads at most HAMILTON_EXPORT_DAILY_FILES
 * a day (src/lib/hamilton/export-limits.ts): a check, never a copy of the database.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) return new Response("Sign in to Hamilton to download this.", { status: 401 });

  const allowance = await checkExportAllowance(user.id);
  if (!allowance.allowed) {
    const status = allowance.reason === "limit" ? 429 : 503;
    await recordExport({ userId: user.id, request, status, rows: 0, truncated: false, reason: `export_${allowance.reason}` });
    return new Response(allowance.reason === "limit" ? EXPORT_LIMIT_MESSAGE : EXPORT_UNAVAILABLE_MESSAGE, {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
    });
  }

  const url = new URL(request.url);
  const ws = await loadFeeWorkspace({
    userId: user.id,
    instId: url.searchParams.get("instId"),
    fee: url.searchParams.get("fee"),
    intent: "research",
  });
  const layer = ws.layers.find((l) => l.key === parseLayer(url.searchParams.get("layer"))) ?? ws.layers[ws.layers.length - 1];

  const lines: string[] = [];
  // A named institution's amount is the price its schedule states. One that states several
  // different fees has none: the amount is blank and the last columns give their range and each fee (#1931).
  const SEVERAL_COLUMNS = ["amount_low", "amount_high", "fees"];
  type Named = { amount: number; several?: SeveralFees };
  const stated = (p: Named) => (p.several ? "" : p.amount);
  const severalCells = (p: Named) => (p.several ? [p.several.low, p.several.high, csvCell(ownFeeList(p.several))] : ["", "", ""]);
  let written = 0;
  let truncated = false;
  if (layer.key === "local" && ws.local) {
    const capped = capExportRows(ws.local.competitors);
    written = capped.rows.length;
    truncated = capped.truncated;
    lines.push(["institution", "deposits_in_market_usd", `${ws.fee}_amount`, "published_at", "source_url", "sod_year", ...SEVERAL_COLUMNS].join(","));
    for (const c of capped.rows) {
      lines.push(
        [csvCell(c.institutionName), csvCell(c.marketDeposits), stated(c), csvCell(c.publishedAt?.slice(0, 10)), csvCell(c.documentUrls[0]), ws.local.sodYear, ...severalCells(c)].join(","),
      );
    }
    if (truncated) {
      lines.push(csvCell(`Note: your market has ${ws.local.competitors.length} institutions; a file lists at most ${HAMILTON_EXPORT_MAX_ROWS}.`));
    }
  } else {
    // The engine's own list for the layer, lowest amount first, so the file holds the institutions the screen counted.
    const capped = capExportRows(layer.members ?? []);
    written = capped.rows.length;
    truncated = capped.truncated;
    lines.push(["institution", "state", `${ws.fee}_amount`, "published_at", "source_url", ...SEVERAL_COLUMNS].join(","));
    for (const p of capped.rows) {
      lines.push([csvCell(p.institutionName), csvCell(p.stateCode), stated(p), csvCell(p.publishedAt?.slice(0, 10)), csvCell(p.documentUrls[0]), ...severalCells(p)].join(","));
    }
    if (truncated) {
      lines.push(csvCell(`Note: the screen counted ${layer.n} institutions; a file lists at most ${HAMILTON_EXPORT_MAX_ROWS}, lowest amount first.`));
    } else if (written !== layer.n) {
      lines.push(csvCell(`Note: the screen counted ${layer.n} institutions; this file lists ${written}.`));
    }
  }

  await recordExport({ userId: user.id, request, status: 200, rows: written, truncated });
  const filename = `hamilton-${ws.fee}-${layer.key}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
