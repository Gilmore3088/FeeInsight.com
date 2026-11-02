import type { ReactNode } from "react";
import "./dashboard.css";

/**
 * One panel of the Hamilton dashboard: a titled card on the parchment ground. `ink` is the navy
 * card (Ask Hamilton). Server-safe: it holds no state, so server and client components both use it.
 */
export function DashboardCard({
  title,
  titleId,
  actions,
  footnote,
  tone = "default",
  className,
  headingLevel = 2,
  children,
}: {
  title: ReactNode;
  /** Id for the heading, so the card's section is labelled by it. */
  titleId?: string;
  /** Controls beside the title (a segmented control, a link). */
  actions?: ReactNode;
  /** The source line under the card's content. */
  footnote?: ReactNode;
  tone?: "default" | "ink";
  className?: string;
  headingLevel?: 2 | 3;
  children?: ReactNode;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <section
      className={`hd-card${tone === "ink" ? " hd-card--ink" : ""}${className ? ` ${className}` : ""}`}
      aria-labelledby={titleId}
    >
      <div className="hd-card-head">
        <Heading id={titleId} className="hd-card-title">{title}</Heading>
        {actions}
      </div>
      {children}
      {footnote ? <p className="hd-card-note">{footnote}</p> : null}
    </section>
  );
}
