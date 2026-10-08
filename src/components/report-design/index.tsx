/**
 * The shared report look for React surfaces (Pro answers, studies, alerts). Same structure
 * and class names as src/lib/report-design/html.ts, styled by REPORT_DESIGN_CSS.
 * Server-safe: no client code. Wrap a surface in <ReportDesign> once; it injects the styles.
 */
import type { ReactNode } from "react";
import { REPORT_DESIGN_CSS } from "@/lib/report-design/css";
import { rdMarkSvg, type RdDocument, type RdExhibit, type RdHero, type RdLegendItem } from "@/lib/report-design/html";

export type { RdDocument, RdExhibit, RdHero, RdLegendItem };

export function ReportDesign({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={className ? `rd ${className}` : "rd"}>
      <style>{REPORT_DESIGN_CSS}</style>
      {children}
    </div>
  );
}

export function ReportHeader({ eyebrow, title, deck, heroes }: Pick<RdDocument, "eyebrow" | "title" | "deck" | "heroes">) {
  return (
    <header className="rd-cover">
      <div className="rd-eyebrow">{eyebrow}</div>
      <h1 className="rd-title">{title}</h1>
      {deck ? <p className="rd-deck">{deck}</p> : null}
      <HeroFigures heroes={heroes} />
    </header>
  );
}

export function HeroFigures({ heroes }: { heroes: RdHero[] }) {
  if (heroes.length === 0) return null;
  return (
    <div className="rd-heroes">
      {heroes.map((h) => (
        <div className="rd-hero" key={h.label}>
          <div className="rd-hero-fig">
            {h.figure}
            {h.unit ? <small>{h.unit}</small> : null}
          </div>
          <div className="rd-hero-lab">{h.label}</div>
          {h.note ? <div className="rd-hero-note">{h.note}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: RdLegendItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rd-legend">
      {items.map((i) => (
        <span key={i.label}>
          {i.color || i.mark ? <span dangerouslySetInnerHTML={{ __html: rdMarkSvg(i.mark, i.color) }} /> : null}
          {i.label}
        </span>
      ))}
    </div>
  );
}

/**
 * One exhibit. Pass `panels` (trusted chart HTML from an exhibit function) or `children`
 * (React content such as a table); `notice` replaces the chart when the data is not there.
 */
export function Exhibit({ exhibit, children }: { exhibit: RdExhibit; children?: ReactNode }) {
  const panels = exhibit.panels ?? [];
  return (
    <section className={exhibit.flow ? "rd-exhibit rd-flow" : "rd-exhibit"} aria-labelledby={`rd-${exhibit.key}`}>
      <div className="rd-label">{exhibit.label}</div>
      <h2 id={`rd-${exhibit.key}`}>{exhibit.title}</h2>
      {exhibit.sub ? <p className="rd-sub">{exhibit.sub}</p> : null}
      {exhibit.legend ? <Legend items={exhibit.legend} /> : null}
      {panels.length > 0 ? (
        <div className={panels.length > 1 ? "rd-pair" : "rd-one"}>
          {panels.map((p, i) => (
            <div className="rd-panel" key={p.heading ?? i}>
              {p.heading ? <h3 className="rd-panel-title">{p.heading}</h3> : null}
              {/* Chart SVG built by exhibit functions from escaped data. */}
              <div dangerouslySetInnerHTML={{ __html: p.html }} />
            </div>
          ))}
        </div>
      ) : null}
      {children}
      {exhibit.notice ? <p className="rd-notice">{exhibit.notice}</p> : null}
      <div className="rd-source">{exhibit.source}</div>
    </section>
  );
}

/** A whole report: header, then each exhibit in order. */
export function ReportDocument({ doc }: { doc: RdDocument }) {
  return (
    <ReportDesign>
      <ReportHeader {...doc} />
      {doc.exhibits.map((ex) => (
        <Exhibit exhibit={ex} key={ex.key} />
      ))}
    </ReportDesign>
  );
}
