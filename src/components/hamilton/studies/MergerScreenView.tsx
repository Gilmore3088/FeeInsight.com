/**
 * The merger screen as a page: cover with headline figures, then five exhibits. Everything
 * shown comes from buildMergerScreen (src/lib/hamilton/studies-exhibits/merger.ts); chart
 * SVG is generated there from escaped data. Server component, no client code.
 */
import { BANK_COLORS, MERGER_CSS, type MergerScreen } from "@/lib/hamilton/studies-exhibits/merger";

function LegendDot({ color }: { color: string }) {
  return (
    <svg width="14" height="14" aria-hidden="true">
      <circle cx="7" cy="7" r="5.5" fill={color} />
    </svg>
  );
}

export function MergerScreenView({ screen }: { screen: MergerScreen }) {
  return (
    <div className="ms">
      <style>{MERGER_CSS}</style>
      <header className="ms-cover">
        <div className="ms-eyebrow">Hamilton · Merger screen</div>
        <h1>{screen.title}</h1>
        {screen.deck ? <p className="ms-deck">{screen.deck}</p> : null}
        {screen.heroes.length > 0 ? (
          <div className="ms-heroes">
            {screen.heroes.map((h) => (
              <div className="ms-hero" key={h.label}>
                <div className="ms-fig">
                  {h.figure}
                  {h.unit ? <small>{h.unit}</small> : null}
                </div>
                <div className="ms-lab">{h.label}</div>
                <div className="ms-vs">{h.detail}</div>
              </div>
            ))}
          </div>
        ) : null}
      </header>

      {screen.exhibits.map((ex) => (
        <section className="ms-ex" key={ex.key} aria-labelledby={`ms-${ex.key}`}>
          <div className="ms-kicker">{ex.kicker}</div>
          <h2 id={`ms-${ex.key}`}>{ex.title}</h2>
          {ex.sub ? <p className="ms-sub">{ex.sub}</p> : null}
          {ex.legend ? (
            <div className="ms-legend">
              {ex.legend.map((item, i) => (
                <span key={item}>
                  {i < 2 ? <LegendDot color={BANK_COLORS[i]} /> : null}
                  {item}
                </span>
              ))}
            </div>
          ) : null}
          {ex.panels.length > 0 ? (
            <div className={ex.panels.length > 1 ? "ms-two" : "ms-one"}>
              {ex.panels.map((p, i) => (
                <div className="ms-panel" key={p.heading ?? i}>
                  {p.heading ? <h3>{p.heading}</h3> : null}
                  {/* SVG built by the exhibit functions; every data string in it is escaped. */}
                  <div dangerouslySetInnerHTML={{ __html: p.html }} />
                </div>
              ))}
            </div>
          ) : null}
          {ex.notice ? <p className="ms-notice">{ex.notice}</p> : null}
          <div className="ms-source">{ex.source}</div>
        </section>
      ))}
    </div>
  );
}
