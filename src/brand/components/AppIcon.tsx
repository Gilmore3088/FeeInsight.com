import * as React from "react";
import { MARKS } from "./logo-paths";

export type AppIconBrand = "fee-insight" | "bank-fee-index" | "hamilton";

export interface AppIconProps extends Omit<React.SVGProps<SVGSVGElement>, "children"> {
  /** fee-insight: box-plot I on navy · bank-fee-index: range bar on brick · hamilton: the HI badge (also the chat avatar). */
  brand?: AppIconBrand;
  size?: number;
  title?: string;
}

const NAVY = "#132338", BRICK = "#b23a32", BRICK_ON_NAVY = "#e0716a", PARCHMENT = "#f3efe6";
const NAMES: Record<AppIconBrand, string> = { "fee-insight": "Fee Insight", "bank-fee-index": "Bank Fee Index", hamilton: "Hamilton" };

/** App tiles keep fixed colours in both themes. */
export function AppIcon({ brand = "fee-insight", size = 40, title, className, ...rest }: AppIconProps) {
  const data = MARKS[`app-icon-${brand}`];
  const fill = {
    "tile-ink": NAVY,
    "tile-accent": BRICK,
    paper: PARCHMENT,
    ink: NAVY,
    accent: brand === "bank-fee-index" ? BRICK : BRICK_ON_NAVY,
    muted: NAVY,
  } as const satisfies Record<string, string>;
  const name = title ?? NAMES[brand];
  return (
    <svg viewBox={data.viewBox} width={size} height={size} className={["fi-appicon", className].filter(Boolean).join(" ")} role={name ? "img" : undefined} aria-label={name || undefined} aria-hidden={name ? undefined : true} {...rest}>
      {name ? <title>{name}</title> : null}
      {data.layers.map((l, i) =>
        "rect" in l ? (
          <rect key={i} x={l.rect[0]} y={l.rect[1]} width={l.rect[2]} height={l.rect[3]} rx={l.rect[4]} fill={fill[l.role]} />
        ) : (
          <path key={i} d={l.d} fill={fill[l.role]} fillRule="evenodd" />
        ),
      )}
    </svg>
  );
}
