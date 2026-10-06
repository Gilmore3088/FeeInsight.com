import { ImageResponse } from "next/og";

export const alt = "The Bank Fee Index: published fees for U.S. banks and credit unions";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PARCHMENT = "#FAF7F2";
const INK = "#1A1815";
const SECONDARY = "#5A5347";
const MUTED = "#7A7062";
const RULE = "#E0D7C9";
const TERRACOTTA = "#C44B2E";
const SERIF_STACK = "Newsreader, Georgia, 'Times New Roman', serif";

const NEWSREADER_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap";
const FONT_FETCH_TIMEOUT_MS = 4000;

/**
 * Best-effort Newsreader load. No font file ships in the repo, so we try Google
 * Fonts at render time (with a short timeout) and fall back to Satori's default
 * face when offline. The card is designed to still read cleanly without it.
 */
async function loadNewsreader(): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(NEWSREADER_CSS_URL, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(FONT_FETCH_TIMEOUT_MS),
    }).then((res) => (res.ok ? res.text() : ""));
    const match = css.match(/src:\s*url\(([^)]+)\)\s*format\(['"]?(?:truetype|opentype)['"]?\)/);
    if (!match) return null;
    const font = await fetch(match[1], { signal: AbortSignal.timeout(FONT_FETCH_TIMEOUT_MS) });
    return font.ok ? font.arrayBuffer() : null;
  } catch {
    return null;
  }
}

function BarsMark({ px }: { px: number }) {
  return (
    <svg viewBox="0 0 24 24" width={px} height={px} fill="none" stroke={TERRACOTTA} strokeWidth={1.5}>
      <rect x="4" y="13" width="4" height="8" rx="1" />
      <rect x="10" y="8" width="4" height="13" rx="1" />
      <rect x="16" y="3" width="4" height="18" rx="1" />
    </svg>
  );
}

export default async function OGImage() {
  const newsreader = await loadNewsreader();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: PARCHMENT,
          padding: "72px 80px",
          fontFamily: SERIF_STACK,
          color: INK,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <BarsMark px={40} />
          <span style={{ fontSize: "30px", fontWeight: 500, letterSpacing: "-0.01em" }}>
            Fee Insight
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "22px", maxWidth: "980px" }}>
          <div
            style={{
              fontSize: "96px",
              fontWeight: 500,
              lineHeight: 1.02,
              letterSpacing: "-0.025em",
              color: INK,
            }}
          >
            The Bank Fee Index
          </div>
          <div style={{ fontSize: "30px", lineHeight: 1.35, color: SECONDARY }}>
            Published fees for U.S. banks and credit unions — every figure traced to a source
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `1px solid ${RULE}`,
            paddingTop: "24px",
            fontSize: "22px",
            color: MUTED,
            letterSpacing: "0.02em",
          }}
        >
          <span>feeinsight.com</span>
          <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: TERRACOTTA }} />
            <span>Verified fee data</span>
          </span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: newsreader
        ? [{ name: "Newsreader", data: newsreader, style: "normal", weight: 500 }]
        : undefined,
    },
  );
}
