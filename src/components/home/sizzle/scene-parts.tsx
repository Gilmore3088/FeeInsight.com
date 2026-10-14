import type { CSSProperties } from "react";
import styles from "./sizzle.module.css";
import { MOTION_SCALE } from "./timeline";

/** Inline style that delays an element's entrance by `ms`. */
export function delay(ms: number, extra?: Record<string, string | number>): CSSProperties {
  return { "--d": `${Math.round(ms * MOTION_SCALE)}ms`, ...extra } as CSSProperties;
}

/** A grey placeholder line: the old way never shows real text or figures. */
export function GreyBar({ width, className = "", style }: { width: string; className?: string; style?: CSSProperties }) {
  return (
    <span
      aria-hidden="true"
      className={`block h-2 rounded-sm bg-control-border/35 ${className}`}
      style={{ width, ...style }}
    />
  );
}

/** A plain document tile: a fee schedule PDF with no bank name or figures on it. */
export function DocTile({ at, label = "PDF" }: { at: number; label?: string }) {
  return (
    <div className={`${styles.in} flex flex-col gap-2 rounded-md border border-border bg-surface-0 p-3`} style={delay(at)}>
      <span className="font-mono text-[10px] font-medium text-ink-muted">{label}</span>
      <GreyBar width="80%" />
      <GreyBar width="62%" />
      <GreyBar width="74%" />
      <GreyBar width="48%" />
    </div>
  );
}

/** A plain spreadsheet frame whose cells fill with grey bars, row after row. */
export function SheetFrame({ rows, startAt, stepMs }: { rows: number; startAt: number; stepMs: number }) {
  return (
    <div className="rounded-md border border-border bg-surface-0" aria-hidden="true">
      <div className="grid grid-cols-[2fr_1fr_1fr] gap-2 border-b border-border bg-surface-200 px-2 py-1.5">
        <GreyBar width="50%" />
        <GreyBar width="60%" />
        <GreyBar width="60%" />
      </div>
      {Array.from({ length: rows }, (_, i) => {
        const at = delay(startAt + i * stepMs);
        return (
          <div key={i} className="grid grid-cols-[2fr_1fr_1fr] items-center gap-2 border-b border-border px-2 py-1.5 last:border-b-0">
            <GreyBar width={`${55 + ((i * 17) % 35)}%`} className={styles.grow} style={at} />
            <GreyBar width="45%" className={styles.grow} style={at} />
            <GreyBar width="40%" className={styles.grow} style={at} />
          </div>
        );
      })}
    </div>
  );
}

/** The "Example" tag every illustrative scene carries. */
export function ExampleTag() {
  return <span className="fi-tag">Example</span>;
}
