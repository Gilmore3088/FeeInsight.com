"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DashboardCard, SegmentedControl } from "@/components/hamilton/dashboard";
import type { HamiltonPeerSetOption } from "@/components/hamilton/PeerBaselineSelector";
import {
  BUILDER_PAGE,
  BUILDER_SECTIONS,
  activeSections,
  buildReportDocument,
  builderDollars,
  encodeBuilderLayout,
  type BuilderData,
  type BuilderDocument,
  type BuilderFeeRow,
  type BuilderLayout,
  type BuilderPage,
  type BuilderPeriod,
  type BuilderSectionKey,
  type BuilderSectionView,
} from "@/lib/hamilton/report-builder";
import { downloadReportPdf } from "./report-pdf-download";
import "./reports-dashboard.css";

/** Positions as words, the same words the PDF prints. */
const POSITION_WORDS: Record<BuilderFeeRow["position"], string> = {
  above: "Above",
  in_range: "In range",
  below: "Below",
  too_few: "Too few to compare",
  not_single: "Several prices",
  not_published: "Not published",
};

const BRICK = "var(--fi-above-market)";
const SAGE = "var(--fi-below-market)";
const SLATE = "var(--fi-in-range)";

/** Scale that fits a page of `width` points into its container (1 CSS px per point at full size). */
function useFitScale(width: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.68);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w > 0) setScale(Math.min(1, w / width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);
  return { ref, scale };
}

function RangePlot({ row }: { row: BuilderFeeRow }) {
  const p = row.plot;
  const W = 170;
  if (!p) return <svg width={W} height={12} aria-hidden="true" />;
  const span = p.high - p.low || 1;
  const x = (v: number) => 4 + ((v - p.low) / span) * (W - 8);
  return (
    <svg width={W} height={12} aria-hidden="true">
      <line x1={4} y1={6} x2={W - 4} y2={6} stroke="var(--fi-border)" strokeWidth={1} />
      {p.q1 !== null && p.q3 !== null ? <rect x={x(p.q1)} y={2} width={Math.max(2, x(p.q3) - x(p.q1))} height={8} fill="var(--fi-brick-tint)" /> : null}
      {p.median !== null ? <line x1={x(p.median)} y1={0} x2={x(p.median)} y2={12} stroke="var(--fi-ink)" strokeWidth={1.2} /> : null}
      {p.yours !== null ? <circle cx={x(p.yours)} cy={6} r={3.6} fill={row.position === "above" ? BRICK : row.position === "below" ? SAGE : SLATE} /> : null}
    </svg>
  );
}

function Donut({ counts }: { counts: { above: number; within: number; below: number } }) {
  const total = counts.above + counts.within + counts.below;
  const r = 30;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const arcs = ([["above", BRICK], ["within", SLATE], ["below", SAGE]] as const).map(([k, color]) => {
    const len = total ? (counts[k] / total) * circ : 0;
    const arc = { k, color, len, offset };
    offset += len;
    return arc;
  });
  return (
    <svg width={80} height={80} viewBox="0 0 80 80" role="img" aria-label={`${counts.above} fees above the peers' middle half, ${counts.within} in it, ${counts.below} below`}>
      <circle cx={40} cy={40} r={r} fill="none" stroke="var(--fi-surface-200)" strokeWidth={12} />
      {arcs.filter((a) => a.len > 0).map((a) => (
        <circle key={a.k} cx={40} cy={40} r={r} fill="none" stroke={a.color} strokeWidth={12} strokeDasharray={`${a.len} ${circ - a.len}`} strokeDashoffset={-a.offset} transform="rotate(-90 40 40)" />
      ))}
    </svg>
  );
}

function TrendPreview({ v }: { v: Extract<BuilderSectionView, { key: "trend" }> }) {
  const W = 480;
  const H = 110;
  const known = [...v.own, ...v.peer.filter((x): x is number => x !== null)];
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  const pad = (hi - lo) * 0.15 || 1;
  const x = (i: number) => 6 + (i * (W - 12)) / Math.max(1, v.own.length - 1);
  const y = (val: number) => H - 6 - ((val - lo + pad) / (hi - lo + 2 * pad)) * (H - 12);
  const own = v.own.map((val, i) => `${x(i).toFixed(1)},${y(val).toFixed(1)}`).join(" ");
  const peer = v.peer.every((p) => p !== null) ? v.peer.map((val, i) => `${x(i).toFixed(1)},${y(val as number).toFixed(1)}`).join(" ") : null;
  const label = `Service charge income by quarter, ${v.quarters[0]} to ${v.quarters[v.quarters.length - 1]}: ${v.own.map((val, i) => `${v.quarters[i]} ${builderDollars(val)}`).join(", ")}`;
  return (
    <div>
      <svg width={W} height={H} role="img" aria-label={label}>
        <line x1={0} y1={H - 1} x2={W} y2={H - 1} stroke="var(--fi-border)" strokeWidth={0.75} />
        {peer ? <polyline points={peer} fill="none" stroke={SLATE} strokeWidth={1.2} strokeDasharray="3 2" /> : null}
        <polyline points={own} fill="none" stroke={BRICK} strokeWidth={1.8} />
      </svg>
      <div className="rb-axis">
        <span>{v.quarters[0]} · {builderDollars(v.own[0])}</span>
        <span>{v.quarters[v.quarters.length - 1]} · {builderDollars(v.own[v.own.length - 1])}</span>
      </div>
      <div className="rb-legend">
        <span><i style={{ background: BRICK }} aria-hidden="true" /> This institution</span>
        {peer ? <span><i style={{ background: SLATE }} aria-hidden="true" /> Median of {v.peerLabel ?? "peers"}</span> : null}
      </div>
    </div>
  );
}

function SectionPreview({ v }: { v: BuilderSectionView }) {
  switch (v.key) {
    case "summary":
      return (
        <div>
          <div className="rb-flex">
            <Donut counts={v.counts} />
            <div>
              <p className="rb-body rb-b">{v.counts.above} of {v.placed} fees compared sit above the peers&apos; middle half</p>
              <p className="rb-small">{v.counts.above} above · {v.counts.within} in range · {v.counts.below} below</p>
              {v.published > v.placed ? <p className="rb-small">{v.published - v.placed} more published fees are not placed: too few peers publish them, or several prices are listed.</p> : null}
            </div>
          </div>
          <p className="rb-body" style={{ marginTop: 8 }}>{v.conclusion}</p>
        </div>
      );
    case "findings":
      return (
        <div>
          {v.empty ? <p className="rb-body">{v.empty}</p> : null}
          {v.items.map((f, i) => (
            <div key={i} className="rb-finding">
              <p className="rb-body rb-b">{f.statement}</p>
              <p className="rb-small">{f.evidence}</p>
              {f.caveats.map((c, j) => <p key={j} className="rb-small">{c}</p>)}
            </div>
          ))}
          {v.unresolvedCount ? <p className="rb-note">{v.unresolvedCount} more {v.unresolvedCount === 1 ? "difference needs" : "differences need"} resolving before it can be relied on; the pricing committee brief lists them.</p> : null}
          {v.nextStep ? (
            <div className="rb-next">
              <p className="rb-body rb-b">Next step: {v.nextStep.action}</p>
              <p className="rb-small">{v.nextStep.rationale}</p>
            </div>
          ) : null}
        </div>
      );
    case "above":
      return (
        <div>
          {v.empty ? <p className="rb-body">{v.empty}</p> : v.rows.map((r) => (
            <div key={r.name} className="rb-row">
              <span style={{ width: 140 }}>{r.name}</span>
              <span className="rb-b rb-num" style={{ width: 50 }}>{r.yours}</span>
              <span style={{ width: 182, padding: "0 6px" }}><RangePlot row={r} /></span>
              <span className="rb-num" style={{ flex: 1, color: BRICK }}>{r.gap ?? ""}</span>
            </div>
          ))}
          {v.more ? <p className="rb-note">{v.more} more above the range in the full list.</p> : null}
          <p className="rb-note">Shaded: the peers&apos; middle half. Line: median. Dot: this institution.</p>
        </div>
      );
    case "fees":
      return (
        <div>
          <div className="rb-head">
            <span style={{ width: 140 }}>Fee</span>
            <span className="rb-num" style={{ width: 64 }}>Yours</span>
            <span className="rb-num" style={{ width: 52 }}>Median</span>
            <span className="rb-num" style={{ width: 110 }}>Middle half, or spread</span>
            <span className="rb-num" style={{ width: 38 }}>Peers</span>
            <span style={{ flex: 1 }}>Position</span>
          </div>
          {v.rows.map((r) => (
            <div key={r.name} className="rb-row">
              <span style={{ width: 140 }}>{r.name}</span>
              <span className="rb-num rb-b" style={{ width: 64 }}>{r.yours}</span>
              <span className="rb-num" style={{ width: 52 }}>{r.median}</span>
              <span className="rb-num" style={{ width: 110 }}>{r.range}</span>
              <span className="rb-num" style={{ width: 38 }}>{r.peers}</span>
              <span style={{ flex: 1, paddingLeft: 8, color: r.position === "above" ? BRICK : undefined }}>{POSITION_WORDS[r.position]}</span>
            </div>
          ))}
          {v.more ? <p className="rb-note">{v.more} more fees in the full list.</p> : null}
          <p className="rb-note">A median needs at least 10 peers. With fewer, the spread is shown and the fee is not placed.</p>
        </div>
      );
    case "trend":
      return v.empty ? <p className="rb-body">{v.empty}</p> : (
        <div>
          <p className="rb-body" style={{ marginBottom: 6 }}>{v.headline}</p>
          <TrendPreview v={v} />
        </div>
      );
    case "changes":
      return v.empty ? <p className="rb-body">{v.empty}</p> : (
        <div>
          <div className="rb-head">
            <span style={{ width: 170 }}>Institution</span>
            <span style={{ width: 110 }}>Fee</span>
            <span style={{ width: 150 }}>Change</span>
            <span style={{ flex: 1 }}>When</span>
          </div>
          {v.rows.map((r, i) => (
            <div key={i} className="rb-row">
              <span style={{ width: 170 }}>{r.who}</span>
              <span style={{ width: 110 }}>{r.fee}</span>
              <span style={{ width: 150 }}>{r.change}</span>
              <span style={{ flex: 1 }}>{r.when}</span>
            </div>
          ))}
          {v.more ? <p className="rb-note">{v.more} more changes in the pricing committee brief.</p> : null}
          <p className="rb-note">Since {v.since}.</p>
        </div>
      );
    case "sources":
      return <div>{v.lines.map((line, i) => <p key={i} className="rb-small" style={{ marginBottom: 3 }}>{line}</p>)}</div>;
  }
}

/** One page as the PDF prints it, at its point size, scaled to fit the column. */
function PagePreview({ doc, page }: { doc: BuilderDocument; page: BuilderPage }) {
  const size = BUILDER_PAGE[doc.pageSize];
  const { ref, scale } = useFitScale(size.width);
  return (
    <div ref={ref} className="rb-page-fit">
      <div style={{ width: size.width * scale, height: size.height * scale }}>
        <article
          className="rb-page"
          aria-label={`Page ${page.number} of ${doc.pageCount}`}
          style={{ width: size.width, height: size.height, transform: `scale(${scale})`, padding: `${BUILDER_PAGE.marginTop}px ${BUILDER_PAGE.marginX}px ${BUILDER_PAGE.marginBottom}px` }}
        >
          {page.number === 1 ? (
            <header className="rb-cover" style={{ height: BUILDER_PAGE.coverHeight - 10 }}>
              <p className="rb-kicker">{doc.title}</p>
              <p className="rb-title">{doc.institutionName}</p>
              <p className="rb-sub">{doc.preparedFor} · against {doc.peerGroupLabel} · read {doc.readOn}</p>
            </header>
          ) : null}
          {page.sections.length === 0 ? <p className="rb-body">No section is ticked. Tick one to add it.</p> : null}
          {page.sections.map((section) => (
            <section key={section.n} style={{ marginBottom: BUILDER_PAGE.sectionGap }}>
              <p className="rb-heading">{section.n}. {section.title}</p>
              <SectionPreview v={section.view} />
            </section>
          ))}
          <footer className="rb-footer" style={{ left: BUILDER_PAGE.marginX, right: BUILDER_PAGE.marginX }}>
            <span>Hamilton, from Fee Insight · {doc.title} · read {doc.readOn}</span>
            <span>Page {page.number} of {doc.pageCount}</span>
          </footer>
        </article>
      </div>
    </div>
  );
}

const PERIODS: { value: BuilderPeriod; label: string }[] = [
  { value: "4", label: "Last 4 quarters" },
  { value: "8", label: "Last 8 quarters" },
  { value: "all", label: "Every quarter on file" },
];

export interface ReportBuilderProps {
  data: BuilderData;
  layout: BuilderLayout;
  onLayoutChange: (next: BuilderLayout) => void;
  /** The saved peer group the builder reads with; null is the workspace default. */
  peerSetId: string | null;
  savedPeerSets: HamiltonPeerSetOption[];
}

/**
 * The builder: tick and order sections on the left, see the pages redraw in the middle, set the
 * peer group, period, audience and page size on the right. Preview, Export PDF and Share link sit
 * above. The PDF prints the same pages (ReportBuilderPdf draws the same BuilderDocument).
 */
export function ReportBuilder({ data, layout, onLayoutChange, peerSetId, savedPeerSets }: ReportBuilderProps) {
  const doc = useMemo(() => buildReportDocument(data, layout), [data, layout]);
  const [showAll, setShowAll] = useState(false);
  const [pageIx, setPageIx] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<{ head: string; text: string; link?: string; error?: boolean } | null>(null);
  const page = doc.pages[Math.min(pageIx, doc.pages.length - 1)];
  const on = new Set(activeSections(layout));
  const unit = doc.pageCount === 1 ? "page" : "pages";

  function set(next: Partial<BuilderLayout>) {
    onLayoutChange({ ...layout, ...next });
    setNotice(null);
  }

  function toggle(key: BuilderSectionKey) {
    set({ on: on.has(key) ? layout.on.filter((k) => k !== key) : [...layout.on, key] });
  }

  function move(index: number, delta: -1 | 1) {
    const order = [...layout.order];
    const j = index + delta;
    if (j < 0 || j >= order.length) return;
    [order[index], order[j]] = [order[j], order[index]];
    set({ order });
  }

  function linkFor(nextPeerSetId: string | null, nextLayout = layout): string {
    const q = new URLSearchParams({ instId: String(data.institutionId) });
    if (nextPeerSetId) q.set("peerSetId", nextPeerSetId);
    q.set("build", encodeBuilderLayout(nextLayout));
    return `/pro/reports?${q.toString()}#report-builder`;
  }

  async function exportPdf() {
    setExporting(true);
    setNotice(null);
    try {
      const slug = doc.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      await downloadReportPdf(
        { type: "report_builder", institutionId: data.institutionId, peerSetId, layout: encodeBuilderLayout(layout) },
        `${slug}-${data.generatedAt.slice(0, 10)}${layout.pageSize === "A4" ? "-a4" : ""}.pdf`,
      );
      setNotice({ head: "PDF ready", text: `${doc.pageCount} ${unit}, ${layout.pageSize === "A4" ? "A4" : "letter size"}, the same pages as the preview.` });
    } catch {
      setNotice({ head: "PDF not created", text: "The PDF couldn't be created. Please try again.", error: true });
    } finally {
      setExporting(false);
    }
  }

  async function share() {
    const link = `${window.location.origin}${linkFor(peerSetId)}`;
    try {
      await navigator.clipboard.writeText(link);
      setNotice({ head: "Link copied", text: "It opens this report with these sections and settings. Only signed-in Hamilton subscribers can open it." });
    } catch {
      setNotice({ head: "Share link", text: "Copy this link. Only signed-in Hamilton subscribers can open it.", link });
    }
  }

  return (
    <section id="report-builder" aria-labelledby="rb-title" className="rb scroll-mt-24">
      <div className="rb-top">
        <div className="min-w-0">
          <h2 id="rb-title" className="hd-card-title">Build: {doc.title}</h2>
          <p className="hd-card-note">
            {doc.sectionCount} {doc.sectionCount === 1 ? "section" : "sections"} · {doc.pageCount} {unit} · {layout.audience === "board" ? "for the board" : "for the pricing committee"}
          </p>
        </div>
        <div className="rb-actions">
          <button type="button" className="fi-btn fi-btn-secondary fi-btn-sm" aria-pressed={showAll} onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show one page" : "Preview every page"}
          </button>
          <button type="button" className="fi-btn fi-btn-primary fi-btn-sm" onClick={exportPdf} disabled={exporting || doc.sectionCount === 0}>
            {exporting ? "Preparing PDF…" : "Export PDF"}
          </button>
          <button type="button" className="fi-btn fi-btn-secondary fi-btn-sm" onClick={share}>Share link</button>
        </div>
      </div>

      {notice ? (
        <div role={notice.error ? "alert" : "status"} className={`rb-notice${notice.error ? " rb-notice--error" : ""}`}>
          <span className="rb-b">{notice.head}</span>
          <span>{notice.text}</span>
          {notice.link ? (
            <label className="rb-link">
              <span className="hd-sr">Report link</span>
              <input type="text" readOnly value={notice.link} onFocus={(e) => e.currentTarget.select()} />
            </label>
          ) : null}
          <button type="button" onClick={() => setNotice(null)}>Close</button>
        </div>
      ) : null}

      <div className="rb-grid">
        <DashboardCard title="Sections" titleId="rb-sections" headingLevel={3} actions={<span className="hd-card-note">{on.size} of {layout.order.length} on</span>} footnote="Tick to include. Arrows set the order.">
          <ol className="rb-secs">
            {layout.order.map((key, i) => {
              const def = BUILDER_SECTIONS[key];
              const checked = on.has(key);
              return (
                <li key={key} className={checked ? "rb-sec rb-sec--on" : "rb-sec"}>
                  <input type="checkbox" id={`rb-sec-${key}`} checked={checked} onChange={() => toggle(key)} />
                  <label htmlFor={`rb-sec-${key}`}>
                    <span className="rb-b">{def.name}</span>
                    <span className="hd-card-note">{def.hint}</span>
                  </label>
                  <span className="rb-tools">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${def.name} up`}>
                      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 8l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
                    </button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === layout.order.length - 1} aria-label={`Move ${def.name} down`}>
                      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        </DashboardCard>

        <div className="rb-center">
          <div className="rb-pagebar">
            <span className="hd-card-note">{layout.pageSize === "A4" ? "A4" : "Letter"} page, shown to fit. Redraws as you change sections.</span>
            {!showAll && doc.pageCount > 1 ? (
              <div role="group" aria-label="Page" className="rb-pagetabs">
                {doc.pages.map((p, i) => (
                  <button key={p.number} type="button" aria-pressed={i === Math.min(pageIx, doc.pages.length - 1)} aria-label={`Page ${p.number}`} onClick={() => setPageIx(i)}>
                    {p.number}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="rb-pages" aria-live="polite">
            {(showAll ? doc.pages : [page]).map((p) => <PagePreview key={p.number} doc={doc} page={p} />)}
          </div>
        </div>

        <DashboardCard title="Settings" titleId="rb-settings" headingLevel={3}>
          <div className="rb-field">
            <label htmlFor="rb-peer" className="hd-label">Peer group</label>
            <select
              id="rb-peer"
              value={peerSetId ?? ""}
              onChange={(e) => window.location.assign(linkFor(e.target.value || null))}
            >
              <option value="">{peerSetId ? "Your default peer group" : data.peerGroupLabel}</option>
              {peerSetId && !savedPeerSets.some((p) => String(p.id) === peerSetId) ? <option value={peerSetId}>{data.peerGroupLabel}</option> : null}
              {savedPeerSets.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
            </select>
          </div>
          <div className="rb-field">
            <label htmlFor="rb-period" className="hd-label">Period</label>
            <select id="rb-period" value={layout.period} onChange={(e) => set({ period: e.target.value as BuilderPeriod })}>
              {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div className="rb-field">
            <span className="hd-label">Audience</span>
            <SegmentedControl label="Audience" options={[{ value: "board", label: "Board" }, { value: "committee", label: "Committee" }]} value={layout.audience} onChange={(v) => set({ audience: v as BuilderLayout["audience"] })} />
          </div>
          <div className="rb-field">
            <span className="hd-label">Page size</span>
            <SegmentedControl label="Page size" options={[{ value: "LETTER", label: "Letter" }, { value: "A4", label: "A4" }]} value={layout.pageSize} onChange={(v) => { set({ pageSize: v as BuilderLayout["pageSize"] }); setPageIx(0); }} />
          </div>
          <dl className="rb-facts">
            <div><dt>Pages</dt><dd className="hd-mono">{doc.pageCount}</dd></div>
            <div><dt>Fees compared</dt><dd className="hd-mono">{doc.feesCompared}</dd></div>
            <div><dt>Above the range</dt><dd className="hd-mono hd-tone-above">▲ {doc.aboveCount}</dd></div>
            <div><dt>Fee data read</dt><dd className="hd-mono">{doc.readOn}</dd></div>
          </dl>
        </DashboardCard>
      </div>
      <p className="hd-card-note">Every figure: published fee schedules, verified against each institution&apos;s own copy, read {doc.readOn}; service charge income from call reports as filed.</p>
    </section>
  );
}
