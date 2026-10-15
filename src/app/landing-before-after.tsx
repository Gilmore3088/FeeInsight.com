import type { ReactNode } from "react";
import { AppIcon } from "@/brand/components";
import { ProductFrame } from "@/components/marketing/product-frame";
import { PRODUCT_NAME, SITE_NAME } from "@/lib/constants";
import { SECTION_INNER, SectionHeading } from "./landing-shared";

/** A paper thumbnail with a short label; the drawing says what it is. */
function Scrap({ label, tilt, children }: { label: string; tilt: string; children: ReactNode }) {
  return (
    <li className={`flex flex-col items-center gap-2 ${tilt}`}>
      <div className="flex h-20 w-16 items-center justify-center rounded-md border border-border bg-surface-0 p-2 shadow-fi-1 sm:h-28 sm:w-24">
        {children}
      </div>
      <span className="max-w-[9rem] text-center text-[11px] font-medium leading-4 text-ink-soft sm:text-[12px]">{label}</span>
    </li>
  );
}

const LINE = "block h-1 rounded-full bg-border";

function PdfPage() {
  return (
    <span className="relative flex h-full w-full flex-col gap-1.5 pt-1">
      <span className={`${LINE} w-3/4 bg-ink-muted/50`} />
      <span className={`${LINE} w-full`} />
      <span className={`${LINE} w-5/6`} />
      <span className={`${LINE} w-full`} />
      <span className={`${LINE} w-2/3`} />
      <span className="absolute bottom-0 right-0 rounded-sm bg-ink-muted px-1 font-mono text-[9px] font-semibold text-on-ink">PDF</span>
    </span>
  );
}

function Sheet() {
  return (
    <span className="grid h-full w-full grid-cols-3 grid-rows-5 gap-px overflow-hidden rounded-sm bg-border">
      {Array.from({ length: 15 }, (_, i) => (
        <span key={i} className={i < 3 ? "bg-surface-200" : "bg-surface-0"} />
      ))}
    </span>
  );
}

function Survey() {
  return (
    <span className="flex h-full w-full items-end justify-center gap-1.5 pb-1">
      {["h-1/3", "h-2/3", "h-1/2", "h-5/6"].map((h) => (
        <span key={h} className={`w-2.5 rounded-t-sm bg-ink-muted/45 ${h}`} />
      ))}
    </span>
  );
}

/** Peer ratios drawn as rows of a ratio table: no digits, since none of them would be real. */
function Ratios() {
  return (
    <span className="flex h-full w-full flex-col justify-center gap-2">
      {["w-6", "w-4", "w-5", "w-3"].map((w, i) => (
        <span key={i} className="flex items-center justify-between gap-1">
          <span className={`${LINE} w-8`} />
          <span className={`h-1.5 rounded-sm bg-ink-muted/45 ${w}`} />
        </span>
      ))}
    </span>
  );
}

function Invoice() {
  return (
    <span className="flex h-full w-full flex-col items-center justify-center gap-1.5">
      <span className="h-6 w-6 rounded-full bg-ink-muted/40" />
      <span className="h-3 w-10 rounded-t-full bg-ink-muted/40" />
      <span className={`${LINE} mt-1 w-12`} />
    </span>
  );
}

const LAYERS = ["Your market", "Your state", "Fed district", "Peer group", "Nation"] as const;

/**
 * Brief 06 §4.3 item 3 (BetterAnalyst's "fragmented stack"): the fee study by hand, drawn as
 * the scraps it is made of, against one product window. Labels only; the drawing argues.
 */
export function LandingBeforeAfter() {
  return (
    <section className="border-t border-border bg-surface-200/50">
      <div className={`${SECTION_INNER} py-16 sm:py-24`}>
        <SectionHeading center title="Five sources, or one" />
        <div className="mt-10 grid items-center gap-6 lg:mt-14 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-8">
          <figure className="relative min-w-0 rounded-2xl border border-dashed border-control-border/60 px-4 pb-6 pt-5 sm:px-8">
            <figcaption className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Today</figcaption>
            <svg
              aria-hidden="true"
              viewBox="0 0 400 260"
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-x-6 bottom-14 top-12 hidden h-[calc(100%-6.5rem)] w-[calc(100%-3rem)] sm:block"
            >
              <path
                d="M40 60 C 140 10, 180 200, 300 70 S 120 230, 360 200 M70 200 C 160 120, 250 260, 340 90"
                fill="none"
                stroke="var(--fi-control-border)"
                strokeWidth="1.5"
                strokeDasharray="5 6"
                opacity="0.6"
              />
            </svg>
            <ul className="relative mt-5 grid grid-cols-3 gap-x-2 gap-y-5 sm:gap-x-3 sm:gap-y-6">
              <Scrap label="Competitor PDFs" tilt="-rotate-3">
                <PdfPage />
              </Scrap>
              <Scrap label="A spreadsheet kept by hand" tilt="rotate-2 sm:translate-y-6">
                <Sheet />
              </Scrap>
              <Scrap label="A national survey average" tilt="-rotate-1">
                <Survey />
              </Scrap>
              <Scrap label="Call-report ratios" tilt="rotate-3 sm:translate-x-10">
                <Ratios />
              </Scrap>
              <Scrap label="A consultant" tilt="-rotate-2 sm:translate-x-6 sm:translate-y-3">
                <Invoice />
              </Scrap>
            </ul>
          </figure>

          <div aria-hidden="true" className="flex justify-center text-ink-muted">
            <svg viewBox="0 0 48 24" className="h-6 w-12 rotate-90 lg:rotate-0">
              <path d="M2 12h40M34 4l8 8-8 8" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </div>

          <ProductFrame label={SITE_NAME} className="fi-window-lift">
            <figure className="flex flex-col items-center gap-3 px-4 py-6 sm:px-8 sm:py-8">
              <figcaption className="sr-only">How {SITE_NAME} works</figcaption>
              <div className="flex items-end gap-1.5" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span key={i} className="flex h-12 w-9 flex-col gap-1 rounded-sm border border-border bg-paper p-1.5">
                    <span className={`${LINE} bg-ink-muted/50`} />
                    <span className={LINE} />
                    <span className={LINE} />
                  </span>
                ))}
              </div>
              <p className="text-[12px] font-medium text-ink-soft">Each institution&apos;s published fee schedule</p>
              <Down />
              <p className="flex items-center gap-2 rounded-full bg-ink py-1.5 pl-1.5 pr-4 text-[14px] font-semibold text-on-ink">
                <AppIcon brand="bank-fee-index" size={26} title="" />
                {PRODUCT_NAME}
              </p>
              <Down />
              <ul className="flex flex-wrap justify-center gap-1.5" aria-label="Five markets">
                {LAYERS.map((layer) => (
                  <li key={layer} className="rounded-full border border-border bg-paper px-2.5 py-1 text-[12px] font-semibold text-ink">
                    {layer}
                  </li>
                ))}
              </ul>
              <Down />
              <p className="flex items-center gap-2 text-[14px] font-semibold text-ink">
                <AppIcon brand="hamilton" size={26} title="" />
                Hamilton
              </p>
            </figure>
          </ProductFrame>
        </div>
      </div>
    </section>
  );
}

function Down() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 20" className="h-5 w-3 text-ink-muted">
      <path d="M6 1v16M1.5 12.5 6 17l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
