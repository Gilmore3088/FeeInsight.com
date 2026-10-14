import type { CSSProperties } from "react";
import { AppIcon } from "@/brand/components";
import { delay } from "./scene-parts";
import { YouDot } from "./scenes-data";
import styles from "./sizzle.module.css";

const QUESTION = "How does our overdraft fee compare in our market?";

/** Scene 5: Ask Hamilton. The question types in, the answer cites its source, the finding is kept. */
export function AskScene() {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2 rounded-md border border-control-border bg-paper px-3 py-2 text-[13px] text-ink">
        <span className="text-ink-muted">Ask Hamilton</span>
        <span className={styles.type} style={delay(150, { "--dur": "1100ms", "--steps": QUESTION.length })}>
          {QUESTION}
        </span>
      </div>
      <div className={`${styles.in} self-end rounded-lg bg-ink px-3 py-2 text-[13px] text-on-ink`} style={delay(1350)}>
        {QUESTION}
      </div>
      <div className={`${styles.in} flex items-start gap-2`} style={delay(1750)}>
        <AppIcon brand="hamilton" size={28} title="Hamilton" />
        <div className="grid max-w-[85%] gap-2 rounded-lg border border-border bg-paper px-3 py-2 text-[13px] text-ink">
          <p>
            Your overdraft fee sits <strong>inside the middle half</strong> of your market, and above the median of your Fed
            district.
          </p>
          <div className="relative h-3.5 w-full">
            <svg viewBox="0 0 100 14" preserveAspectRatio="none" className="h-3.5 w-full" aria-hidden="true">
              <line x1={10} x2={90} y1={7} y2={7} stroke="var(--fi-control-border)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
              <rect x={36} width={30} y={2} height={10} fill="var(--fi-brick-tint)" />
              <line x1={51} x2={51} y1={1} y2={13} stroke="var(--fi-ink)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            </svg>
            <YouDot left={57} at={0} />
          </div>
          <span className="text-[11px] text-ink-muted">Source: each institution&apos;s published fee schedule, with page and date</span>
        </div>
      </div>
      <div className="relative ml-9 h-8">
        <span className={`${styles.in} absolute left-0 top-0`} style={delay(2300)}>
          <span
            className={`${styles.swapOut} block rounded-md border border-control-border bg-surface-0 px-3 py-1.5 text-[12px] font-semibold text-ink`}
            style={delay(2750)}
          >
            + Add to report
          </span>
        </span>
        <span
          className={`${styles.in} absolute left-0 top-0 rounded-md bg-ink px-3 py-1.5 text-[12px] font-semibold text-on-ink`}
          style={delay(2750)}
        >
          ✓ Added to report
        </span>
      </div>
    </div>
  );
}

const DELIVERABLES = ["CEO one-pager", "Board memo", "Pricing committee packet"] as const;

/** Scenes 6 and 7: the Peer Brief assembles, then rests as the finished study. */
export function ReportScene({ settled }: { settled: boolean }) {
  const at = (ms: number) => delay(settled ? 0 : ms);
  return (
    <div className="grid h-full grid-cols-1 gap-3 sm:grid-cols-[1.5fr_1fr]">
      <article className={`${styles.in} flex flex-col gap-2 rounded-md border border-border bg-paper p-4 shadow-fi-1`} style={at(0)}>
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Fee Insight · Peer Brief</span>
        <h4 className="text-[17px] font-extrabold leading-tight tracking-tight text-ink">Overdraft and NSF against your market</h4>
        <ReportSection title="Summary" at={at(250)} lines={["92%", "78%"]} />
        <div className={`${styles.in} rounded-sm bg-brick-tint/60 px-2 py-1.5`} style={at(650)}>
          <div className="text-[11px] font-semibold text-ink">Findings you added</div>
          <div className="text-[11px] text-ink">Overdraft: inside the middle half of your market.</div>
        </div>
        <ReportSection title="Snapshot against the benchmark" at={at(1050)} lines={["86%", "64%"]} />
        <span className={`${styles.fade} mt-auto border-t border-border pt-1.5 text-[10px] text-ink-muted`} style={at(1400)}>
          Every figure cites the institution&apos;s published fee schedule.
        </span>
      </article>
      <div className="flex flex-col justify-center gap-2">
        <span className={`${styles.fade} text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted`} style={at(1600)}>
          Turn this into
        </span>
        {DELIVERABLES.map((name, i) => (
          <span
            key={name}
            className={`${styles.in} rounded-md border border-border bg-surface-0 px-3 py-2 text-[12px] font-semibold text-ink`}
            style={at(1800 + i * 200)}
          >
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

function ReportSection({ title, at, lines }: { title: string; at: CSSProperties; lines: string[] }) {
  return (
    <div className={`${styles.in} grid gap-1`} style={at}>
      <div className="text-[11px] font-semibold text-ink">{title}</div>
      {lines.map((width) => (
        <span key={width} aria-hidden="true" className="block h-1.5 rounded-sm bg-control-border/35" style={{ width }} />
      ))}
    </div>
  );
}
