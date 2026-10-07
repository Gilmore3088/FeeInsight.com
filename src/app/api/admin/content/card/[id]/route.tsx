import { ImageResponse } from "next/og";
import { NextRequest, NextResponse } from "next/server";
import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { getContentDraft } from "@/lib/data-store/content-drafts";
import { asOfLabel, money, type MarketSpread } from "@/lib/agents/content/market-spread";

export const dynamic = "force-dynamic";

const SIZE = 1080;
const PARCHMENT = "#FAF7F2";
const INK = "#1A1815";
const SECONDARY = "#5A5347";
const RULE = "#E0D7C9";
const TERRACOTTA = "#C44B2E";
const BAND = "#F1E4DA";

const STRIP_LEFT = 90;
const STRIP_WIDTH = SIZE - 180;
const DOT = 26;

/** A draft's square card, drawn only from the facts stored with it. */
async function handleGET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "view")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const draft = await getContentDraft(Number(id));
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  const facts = draft.facts as unknown as MarketSpread & { fee_label?: string; metro_label?: string };
  const values = Array.isArray(facts.values) ? facts.values.map(Number) : [];
  if (values.length === 0) return NextResponse.json({ error: "This draft has no values to draw" }, { status: 422 });

  const top = Math.max(...values, 1);
  const x = (value: number) => STRIP_LEFT + (value / top) * STRIP_WIDTH;
  const stacks = new Map<number, number>();
  const dots = values.map((value) => {
    const level = stacks.get(value) ?? 0;
    stacks.set(value, level + 1);
    return { value, level };
  });
  const tallest = Math.max(...stacks.values());
  const base = 640;
  const step = Math.min(DOT + 4, 300 / Math.max(tallest, 1));

  return new ImageResponse(
    (
      <div style={{ width: SIZE, height: SIZE, display: "flex", flexDirection: "column", background: PARCHMENT, padding: 80, color: INK, fontFamily: "Georgia, serif" }}>
        <div style={{ display: "flex", fontSize: 28, color: SECONDARY, letterSpacing: 1 }}>FEE INSIGHT</div>
        <div style={{ display: "flex", fontSize: 64, lineHeight: 1.1, marginTop: 40 }}>{`${facts.fee_label ?? "Fee"} in ${facts.metro_label ?? "this market"}`}</div>
        <div style={{ display: "flex", fontSize: 40, color: SECONDARY, marginTop: 20 }}>
          {`${money(facts.low)} to ${money(facts.high)} across ${facts.institutions} local banks and credit unions`}
        </div>
        <div style={{ display: "flex", position: "relative", width: SIZE - 160, height: 420, marginTop: 30 }}>
          <div style={{ position: "absolute", left: x(facts.p25) - 80, top: 60, width: Math.max(x(facts.p75) - x(facts.p25), 4), height: base - 360, background: BAND, display: "flex" }} />
          <div style={{ position: "absolute", left: STRIP_LEFT - 80, top: base - 340, width: STRIP_WIDTH, height: 2, background: RULE, display: "flex" }} />
          {dots.map((dot, index) => (
            <div
              key={index}
              style={{
                position: "absolute",
                left: x(dot.value) - 80 - DOT / 2,
                top: base - 340 - DOT - 6 - dot.level * step,
                width: DOT,
                height: DOT,
                borderRadius: DOT,
                background: TERRACOTTA,
                display: "flex",
              }}
            />
          ))}
          <div style={{ position: "absolute", left: x(facts.low) - 80 - 30, top: base - 320, fontSize: 30, color: SECONDARY, display: "flex" }}>{money(facts.low)}</div>
          <div style={{ position: "absolute", left: x(facts.high) - 80 - 30, top: base - 320, fontSize: 30, color: SECONDARY, display: "flex" }}>{money(facts.high)}</div>
          <div style={{ position: "absolute", left: x(facts.p25) - 80, top: 20, fontSize: 26, color: SECONDARY, display: "flex" }}>
            {`Middle half: ${money(facts.p25)} to ${money(facts.p75)}`}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: "auto", borderTop: `2px solid ${RULE}`, paddingTop: 24, fontSize: 24, color: SECONDARY }}>
          <div style={{ display: "flex" }}>{`Each dot is one institution's published fee. Source: the Bank Fee Index, as of ${asOfLabel(new Date(draft.asOf))}.`}</div>
          <div style={{ display: "flex", marginTop: 8 }}>See where any institution stands with Hamilton at feeinsight.com</div>
        </div>
      </div>
    ),
    { width: SIZE, height: SIZE },
  );
}

export const GET = withApiRoutePolicy("api.admin.content.card", "GET", handleGET);
