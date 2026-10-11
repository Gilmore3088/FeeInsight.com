"use client";

import { memo, useEffect, useRef, useState } from "react";
import Link from "next/link";

export interface CountyDetail {
  name: string;
  /** Deposit-weighted published fee; null when no institution there has one on file. */
  fee: number | null;
  /** Institutions with branches in the county. */
  institutions: number;
  /** Branch deposits in the county, in dollars. */
  deposits: number;
  /** Deposits at institutions with a published fee, in dollars. */
  covered: number;
  /** The largest institutions there by deposits, each with its own fee. */
  top: Array<{ id: number; name: string; fee: number | null; deposits: number }>;
}

interface CountyPriceMapProps {
  /** The map drawn at desktop width (paths carry data-fips). */
  wide: string;
  /** The map drawn at phone width, when there is one. */
  narrow: string | null;
  details: Record<string, CountyDetail>;
  price: number;
  feeNoun: string;
}

const money = (v: number) => (Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`);

function deposits(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${Math.round(v / 1e6)}M`;
  return `$${Math.round(v / 1e3)}K`;
}

function versus(fee: number, price: number): string {
  const d = Math.round((fee - price) * 100) / 100;
  if (Math.abs(d) < 0.005) return `same as ${money(price)}`;
  return `${money(Math.abs(d))} ${d > 0 ? "above" : "below"} ${money(price)}`;
}

/**
 * One drawing, kept out of re-renders: the hover readout re-renders the map's parent on every
 * pointer move, and the outline and title changes made to these paths must survive that.
 */
const Drawing = memo(function Drawing({ html, className }: { html: string; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
});

/**
 * The county map with a readout that follows the pointer and a panel that opens on click (or
 * tap) with the largest institutions in that county and their own fees.
 */
export function CountyPriceMap({ wide, narrow, details, price, feeNoun }: CountyPriceMapProps) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ fips: string; x: number; y: number; w: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  // The drawn paths carry a <title> for readers without script; the readout replaces it here.
  useEffect(() => {
    box.current?.querySelectorAll("path[data-fips] > title").forEach((t) => t.remove());
  }, [wide, narrow]);

  // Outline the opened county on both drawings.
  useEffect(() => {
    const root = box.current;
    if (!root) return;
    root.querySelectorAll<SVGPathElement>("path[data-fips]").forEach((p) => {
      const on = p.dataset.fips === selected;
      p.setAttribute("stroke", on ? "#1A1815" : "#FFFFFF");
      p.setAttribute("stroke-width", on ? "2.4" : "0.8");
      if (on) p.parentNode?.appendChild(p);
    });
  }, [selected]);

  const fipsAt = (target: EventTarget | null): string | null =>
    target instanceof Element ? (target.closest("path[data-fips]") as SVGPathElement | null)?.dataset.fips ?? null : null;

  const shown = hover ? details[hover.fips] : null;
  const open = selected ? details[selected] : null;

  return (
    <div className="lg:mt-3 lg:grid lg:grid-cols-[minmax(0,1.8fr)_minmax(18rem,1fr)] lg:items-start lg:gap-6">
      <div
        ref={box}
        className="relative mt-3 cursor-pointer rounded-xl lg:mt-0 border border-[#E8DFD1]/80 bg-white p-2"
        onMouseMove={(e) => {
          const fips = fipsAt(e.target);
          const rect = box.current?.getBoundingClientRect();
          setHover(fips && rect ? { fips, x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width } : null);
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const fips = fipsAt(e.target);
          if (fips) setSelected((current) => (current === fips ? null : fips));
        }}
      >
        <Drawing html={wide} className={narrow ? "hidden sm:block" : undefined} />
        {narrow && <Drawing html={narrow} className="sm:hidden" />}
        {hover && (
          <div
            className="pointer-events-none absolute z-10 hidden w-max max-w-[16rem] rounded-lg border border-[#E8DFD1] bg-white px-3 py-2 text-[12px] shadow-md sm:block"
            style={{ left: Math.max(0, Math.min(hover.x + 14, hover.w - 200)), top: hover.y + 14 }}
          >
            <p className="font-semibold text-[#1A1815]">{shown?.name ?? "County"}</p>
            {shown?.fee != null ? (
              <p className="tabular-nums text-[#5A5347]">
                <b className="text-[#1A1815]">{money(Math.round(shown.fee * 100) / 100)}</b> · {versus(shown.fee, price)}
              </p>
            ) : (
              <p className="text-[#6B6255]">No published {feeNoun} yet</p>
            )}
            {shown && shown.institutions > 0 && (
              <p className="text-[#6B6255]">
                {shown.institutions} {shown.institutions === 1 ? "institution" : "institutions"} · click for detail
              </p>
            )}
          </div>
        )}
      </div>

      {open ? (
        <div className="mt-3 rounded-xl border border-[#E8DFD1] bg-[#FAF7F2] p-4 lg:mt-0">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[15px] font-semibold text-[#1A1815]">{open.name}</p>
            <button type="button" onClick={() => setSelected(null)} className="text-[12px] text-[#A93D25] hover:underline">
              Close
            </button>
          </div>
          <p className="mt-1 text-[13px] text-[#5A5347]">
            {open.institutions === 0 ? (
              <>No bank or credit union reports a branch here in the FDIC deposit data.</>
            ) : open.fee != null ? (
              <>
                <b className="tabular-nums text-[#1A1815]">{money(Math.round(open.fee * 100) / 100)}</b> weighted {feeNoun},{" "}
                {versus(open.fee, price)}.{" "}
              </>
            ) : (
              <>No institution here has a published {feeNoun} yet. </>
            )}
            {open.institutions > 0 && (
              <>
                {open.institutions} {open.institutions === 1 ? "institution" : "institutions"}, {deposits(open.deposits)} in branch deposits.
              </>
            )}
            {open.fee != null && open.deposits > 0 && (
              <> Institutions with a fee on file hold {Math.round((open.covered / open.deposits) * 100)}% of those deposits.</>
            )}
          </p>
          {open.top.length > 0 && (
            <ul className="mt-3 divide-y divide-[#E8DFD1]/70 rounded-lg border border-[#E8DFD1]/80 bg-white">
              {open.top.map((i) => (
                <li key={i.id} className="flex items-baseline justify-between gap-3 px-3 py-2 text-[13px]">
                  <span className="min-w-0">
                    <Link href={`/institution/${i.id}`} className="text-[#1A1815] hover:underline">
                      {i.name}
                    </Link>{" "}
                    <span className="text-[11px] text-[#6B6255]">{deposits(i.deposits)} here</span>
                  </span>
                  <span
                    className={`shrink-0 tabular-nums ${
                      i.fee == null ? "text-[#A09788]" : i.fee > price ? "text-[#A93D25]" : i.fee < price ? "text-[#3D3830]" : "text-[#1A1815]"
                    }`}
                  >
                    {i.fee == null ? "not on file" : money(Math.round(i.fee * 100) / 100)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {open.institutions > open.top.length && (
            <p className="mt-2 text-[12px] text-[#6B6255]">The {open.top.length} largest by deposits in the county.</p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-[#6B6255] lg:mt-0 lg:rounded-xl lg:border lg:border-dashed lg:border-[#E8DFD1] lg:p-4 lg:text-[13px]">Hover a county for its fee. Click or tap it to see the institutions there.</p>
      )}
    </div>
  );
}
