import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { getCategoryPeerAmounts, type PeerAmount } from "@/lib/data-store/fee-research";
import { loadFeeWorkspace } from "@/lib/hamilton/fee-workspace-data";
import { parseLayer } from "@/lib/hamilton/research-layers";

export const dynamic = "force-dynamic";

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The institutions in a non-local layer. The engine returns each layer's amounts but not who they
 * belong to, so this reads the same approved catalog values and applies the same layer rule; the
 * file says how many rows the screen counted so a mismatch shows.
 */
function inLayer(key: string, inst: { id: number; stateCode: string | null; fedDistrict: number | null; charterType: string | null; assetTier: string | null }, p: PeerAmount): boolean {
  if (p.institutionId === inst.id) return false;
  if (key === "state") return p.stateCode === inst.stateCode;
  if (key === "district") return p.fedDistrict === inst.fedDistrict;
  if (key === "peers") return p.charterType === inst.charterType && p.assetTier === inst.assetTier;
  return true;
}

/**
 * Every institution behind a Research or Model comparison, with its value, publish date and the
 * fee schedule it came from, so a client can check any figure Hamilton shows.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) return new Response("Sign in to Hamilton to download this.", { status: 401 });

  const url = new URL(request.url);
  const ws = await loadFeeWorkspace({
    userId: user.id,
    instId: url.searchParams.get("instId"),
    fee: url.searchParams.get("fee"),
    intent: "research",
  });
  const layer = ws.layers.find((l) => l.key === parseLayer(url.searchParams.get("layer"))) ?? ws.layers[ws.layers.length - 1];

  const lines: string[] = [];
  if (layer.key === "local" && ws.local) {
    lines.push(["institution", "deposits_in_market_usd", `${ws.fee}_amount`, "published_at", "source_url", "sod_year"].join(","));
    for (const c of ws.local.competitors) {
      lines.push(
        [csvCell(c.institutionName), csvCell(c.marketDeposits), c.amount, csvCell(c.publishedAt?.slice(0, 10)), csvCell(c.documentUrls[0]), ws.local.sodYear].join(","),
      );
    }
  } else if (ws.institution) {
    const inst = ws.institution;
    const rows = (await getCategoryPeerAmounts(ws.fee).catch(() => [] as PeerAmount[])).filter((p) => inLayer(layer.key, inst, p));
    lines.push(["institution", "state", "charter", "fed_district", "asset_tier", `${ws.fee}_amount`, "published_at", "source_url"].join(","));
    for (const p of rows) {
      lines.push(
        [csvCell(p.name), csvCell(p.stateCode), csvCell(p.charterType), csvCell(p.fedDistrict), csvCell(p.assetTier), p.amount, csvCell(p.publishedAt?.slice(0, 10)), csvCell(p.sourceUrl)].join(","),
      );
    }
    if (rows.length !== layer.n) lines.push(csvCell(`Note: the screen counted ${layer.n} institutions; this file lists ${rows.length}.`));
  }

  const filename = `hamilton-${ws.fee}-${layer.key}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
