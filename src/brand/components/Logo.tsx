import * as React from "react";
import { MARKS, type MarkName } from "./logo-paths";

export type LogoMark = Exclude<MarkName, `app-icon-${string}`>;

export interface LogoProps extends Omit<React.SVGProps<SVGSVGElement>, "children"> {
  /** Which mark to draw. Lockups include "Powered by Fee Insight". */
  mark?: LogoMark;
  /** "auto" follows the theme; "light" / "reverse" force a colourway; "mono" draws in currentColor. */
  tone?: "auto" | "light" | "reverse" | "mono";
  /** Rendered height in px; width follows the mark's proportions. */
  height?: number;
  /** Accessible name. Defaults to the brand name. Pass "" when the logo sits next to visible text with the same name. */
  title?: string;
}

const NAMES: Record<LogoMark, string> = {
  "fee-insight-stacked": "Fee Insight",
  "fee-insight-oneline": "Fee Insight",
  "bank-fee-index-lockup": "Bank Fee Index, powered by Fee Insight",
  "bank-fee-index-wordmark": "Bank Fee Index",
  "hamilton-lockup": "Hamilton, powered by Fee Insight",
  "hamilton-wordmark": "Hamilton",
  "box-plot-i": "Fee Insight",
};

const FILL = { ink: "var(--fi-mark-ink)", accent: "var(--fi-mark-accent)", muted: "var(--fi-mark-muted)", paper: "var(--fi-paper)" } as const;

export function Logo({ mark = "fee-insight-stacked", tone = "auto", height = 40, title, className, style, ...rest }: LogoProps) {
  const data = MARKS[mark];
  const [, , w, h] = data.viewBox.split(" ").map(Number);
  const name = title ?? NAMES[mark];
  const toneClass = tone === "auto" ? "" : ` fi-mark--${tone}`;
  return (
    <svg
      viewBox={data.viewBox}
      height={height}
      width={(height * w) / h}
      role={name ? "img" : undefined}
      aria-label={name || undefined}
      aria-hidden={name ? undefined : true}
      className={`fi-mark${toneClass}${className ? ` ${className}` : ""}`}
      style={tone === "mono" ? { ["--fi-mark-ink" as string]: "currentColor", ...style } : style}
      {...rest}
    >
      {name ? <title>{name}</title> : null}
      {data.layers.map((l, i) =>
        "d" in l ? <path key={i} d={l.d} fill={FILL[l.role]} fillRule="evenodd" /> : null,
      )}
    </svg>
  );
}
