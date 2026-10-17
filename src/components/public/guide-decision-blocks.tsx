import Link from "next/link";
import type { GuideBlock, RegulatoryStatus } from "@/lib/guides";
import { resolveTokens } from "@/lib/guides";
import { scenarioCost } from "@/lib/guides/scenarios";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import type { DailyCapScope, NationalComplaintThemes } from "@/lib/data-store/overdraft-policies";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { PRODUCT_NAME } from "@/lib/constants";
import { DistributionChart } from "@/components/public/distribution-chart";
import { AccountCompare, type CompareFeature } from "@/components/public/guide-account-compare";
import { AtmReceipt } from "@/components/public/atm-receipt";
import type { AtmTwoFeeExample } from "@/lib/guides/atm-example";

/**
 * The decision blocks of a consumer guide: where the reader starts, what happens to one
 * payment, what scenarios cost, which policy features to check and what changed in the rules.
 * Every figure is a live median or count; nothing here is typed as a dollar amount.
 */

/** Live reads a guide's blocks may need beyond the fee summaries. */
export interface GuideExtras {
  distribution?: { category: string; values: number[]; median: number | null };
  capScope?: DailyCapScope | null;
  complaints?: NationalComplaintThemes | null;
  /** Two institutions' live published ATM fees, for a breakdown marked `live: "atm_two_fee"`. */
  atmExample?: AtmTwoFeeExample | null;
}

function Prose({ text, summaries, className }: { text: string; summaries: FeeCategorySummary[]; className?: string }) {
  const { html } = resolveTokens(text, summaries);
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function PathsBlock({ block, summaries }: { block: Extract<GuideBlock, { type: "paths" }>; summaries: FeeCategorySummary[] }) {
  return (
    <ul className="mt-5 grid gap-3 md:grid-cols-3">
      {block.paths.map((path) => (
        <li key={path.href}>
          <a
            href={path.href}
            className="group flex h-full flex-col rounded-xl border border-border bg-surface-0 px-5 py-4 no-underline transition-colors hover:border-ink"
          >
            <span className="text-[16px] font-semibold leading-snug text-ink">{path.question}</span>
            <Prose text={path.answer} summaries={summaries} className="mt-2 flex-1 text-[13.5px] leading-relaxed text-ink-soft" />
            <span className="mt-3 text-[13px] font-semibold text-brick group-hover:underline">Start here</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

const OUTCOME_MARK = {
  paid: { label: "Paid", className: "bg-surface-200 text-ink" },
  returned: { label: "Returned", className: "bg-brick/10 text-brick" },
  transfer: { label: "Covered by transfer", className: "bg-[#EAF0EC] text-below-market" },
  deposit_returned: { label: "Deposit returned", className: "bg-brick/10 text-brick" },
} as const;

export function OutcomesBlock({ block, summaries }: { block: Extract<GuideBlock, { type: "outcomes" }>; summaries: FeeCategorySummary[] }) {
  return (
    <figure className="mt-5 rounded-xl border border-border bg-surface-0 p-4 sm:p-5">
      <p className="text-[14px] font-semibold text-ink">
        <Prose text={block.setup} summaries={summaries} />
      </p>
      <ol className="mt-4 grid gap-3 md:grid-cols-3">
        {block.outcomes.map((o) => (
          <li key={o.kind} className="flex flex-col rounded-lg border border-border bg-paper px-4 py-4">
            <span className={`self-start rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${OUTCOME_MARK[o.kind].className}`}>
              {OUTCOME_MARK[o.kind].label}
            </span>
            <span className="mt-2 text-[15px] font-semibold text-ink">{o.title}</span>
            <dl className="mt-2 space-y-2 text-[13.5px] leading-relaxed">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">The payment</dt>
                <dd className="text-ink-soft"><Prose text={o.payment} summaries={summaries} /></dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">What it may cost</dt>
                <dd className="text-ink-soft"><Prose text={o.cost} summaries={summaries} /></dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Afterwards</dt>
                <dd className="text-ink-soft"><Prose text={o.after} summaries={summaries} /></dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
    </figure>
  );
}

export function ScenariosBlock({ block, summaries }: { block: Extract<GuideBlock, { type: "scenarios" }>; summaries: FeeCategorySummary[] }) {
  const { policy } = block;
  const costs = block.scenarios.map((s) => scenarioCost(policy, s));
  if (costs.length === 0) return null;
  const terms = [
    `${formatAmount(policy.perItem)} per fee`,
    policy.maxPerDay != null ? `at most ${policy.maxPerDay} fees a day` : "no daily limit",
    policy.extended != null ? `${formatAmount(policy.extended)} if the balance stays negative` : null,
    policy.transfer != null ? `${formatAmount(policy.transfer)} per savings transfer` : null,
  ].filter(Boolean);
  return (
    <div className="mt-5">
      {block.intro && (
        <p className="text-[15px] leading-[1.75] text-ink-soft">
          <Prose text={block.intro} summaries={summaries} />
        </p>
      )}
      <p className="mt-4 rounded-lg border border-dashed border-border bg-paper px-4 py-3 text-[13px] text-ink-soft">
        <span className="font-semibold text-ink">Illustrative account, not any institution&rsquo;s terms:</span> {terms.join(", ")}.
      </p>
      <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface-0">
        {costs.map((c) => (
          <li key={c.title} className="flex flex-col gap-1 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:px-5">
            <div className="min-w-0">
              <p className="text-[14.5px] font-semibold text-ink">{c.title}</p>
              <p className="mt-0.5 text-[12.5px] text-ink-muted">
                {c.parts.map((p) => `${p.label} ${formatAmount(p.amount)}`).join(" + ")}
                {c.limited ? ". The daily limit stops the rest." : ""}
              </p>
              {c.note && <p className="mt-1 text-[12.5px] text-ink-muted">{c.note}</p>}
            </div>
            <p className="shrink-0 text-[18px] font-semibold tabular-nums text-ink sm:text-right">{formatAmount(c.total)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BreakdownBlock({ block, extras = {} }: { block: Extract<GuideBlock, { type: "breakdown" }>; extras?: GuideExtras }) {
  if (block.live === "atm_two_fee" && extras.atmExample) {
    return (
      <div className="mt-5">
        <AtmReceipt example={extras.atmExample} />
      </div>
    );
  }
  const total = block.items.reduce((sum, i) => sum + (i.sign === "minus" ? -i.amount : i.amount), 0);
  return (
    <figure className="mt-5 max-w-md rounded-xl border border-border bg-surface-0 p-4 sm:p-5">
      <figcaption className="text-[14px] font-semibold text-ink">{block.title}</figcaption>
      <dl className="mt-3 space-y-2 text-[14px]">
        {block.items.map((i, n) => (
          <div key={i.label} className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-soft">
              {n > 0 && <span aria-hidden="true" className="mr-1.5 text-ink-muted">{i.sign === "minus" ? "−" : "+"}</span>}
              {i.label}
            </dt>
            <dd className="tabular-nums text-ink">{formatAmount(i.amount)}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 border-t border-ink pt-2 font-semibold">
          <dt className="text-ink">{block.totalLabel}</dt>
          <dd className="tabular-nums text-ink">{formatAmount(total)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-[12px] text-ink-muted">{block.note}</p>
    </figure>
  );
}

export function DistributionBlock({
  block,
  extras,
}: {
  block: Extract<GuideBlock, { type: "distribution" }>;
  extras: GuideExtras;
}) {
  const d = extras.distribution;
  if (!d || d.category !== block.category || d.values.length < 5) return null;
  return (
    <figure className="mt-5 rounded-xl border border-border bg-surface-0 p-4 sm:p-5">
      <div className="mx-auto max-w-xl">
        <DistributionChart values={d.values} median={d.median} bucketCount={16} />
      </div>
      <figcaption className="mt-3 text-[12px] text-ink-muted">
        {block.caption ?? `${getDisplayName(block.category)}: one value per institution`}, {d.values.length.toLocaleString()} institutions.{" "}
        <Link href={`/fees?fee=${block.category}#explorer`} className="font-medium text-brick hover:underline">
          Explore by state and charter
        </Link>
      </figcaption>
    </figure>
  );
}

export function CapScopeBlock({ extras }: { extras: GuideExtras }) {
  const s = extras.capScope;
  if (!s) return null;
  const total = s.overdraft + s.nsf + s.both + s.unstated;
  if (total === 0) return null;
  const parts = [
    s.overdraft && `${s.overdraft} to overdraft fees only`,
    s.nsf && `${s.nsf} to NSF fees only`,
    s.both && `${s.both} to both combined`,
    s.unstated && `${s.unstated} without saying which`,
  ].filter(Boolean);
  return (
    <p className="mt-4 rounded-lg bg-paper px-4 py-3 text-[13.5px] leading-relaxed text-ink-soft">
      <strong className="font-semibold text-ink">What the daily limit figure covers.</strong> {total.toLocaleString()} institutions publish a daily limit in
      dollars. They apply it {parts.join(", ")}. A limit stated as a number of fees per day is not in this figure.
    </p>
  );
}

export function PolicyTableBlock({
  block,
  summaries,
}: {
  block: Extract<GuideBlock, { type: "policy_table" }>;
  summaries: FeeCategorySummary[];
}) {
  const byCategory = new Map(summaries.map((s) => [s.fee_category, s]));
  const features: CompareFeature[] = block.rows.map((r) => ({ feature: r.feature, question: r.question, category: r.category ?? null }));
  return (
    <div className="mt-5">
      <dl className="divide-y divide-border rounded-xl border border-border bg-surface-0">
        {block.rows.map((row) => {
          const s = row.category ? byCategory.get(row.category) : undefined;
          return (
            <div key={row.feature} className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)] sm:gap-4 sm:px-5">
              <dt className="text-[14px] font-semibold text-ink">{row.feature}</dt>
              <dd className="text-[13.5px] text-ink-soft">{row.question}</dd>
              <dd className="text-[13px] text-ink-muted">
                {s && row.countOnly ? (
                  `Published by ${s.institution_count.toLocaleString()} institutions, with different scopes. Ask what yours covers.`
                ) : s && s.median_amount != null ? (
                  <Link href={`/fees?fee=${row.category}#explorer`} className="text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
                    Median {formatAmount(s.median_amount)}, {s.institution_count.toLocaleString()} institutions
                  </Link>
                ) : (
                  "Not verified. Ask the institution."
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {block.compare && (
        <div id="compare-accounts" className="mt-6 scroll-mt-24">
          <p className="text-[15px] leading-[1.75] text-ink-soft">
            <Prose text={block.compare.intro} summaries={summaries} />
          </p>
          <AccountCompare features={features} set={block.compare.set ?? "overdraft"} />
        </div>
      )}
    </div>
  );
}

export function ComplaintsBlock({
  block,
  summaries,
  extras,
}: {
  block: Extract<GuideBlock, { type: "complaints" }>;
  summaries: FeeCategorySummary[];
  extras: GuideExtras;
}) {
  const c = extras.complaints;
  return (
    <details className="group mt-5 rounded-xl border border-border bg-surface-0 px-4 py-3 sm:px-5">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-semibold text-ink">
        What consumers report
        <span aria-hidden="true" className="text-ink-muted transition-transform group-open:rotate-45">+</span>
      </summary>
      <div className="pb-2">
        <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
          <Prose text={block.text} summaries={summaries} />
        </p>
        {c && c.themes.length > 0 && (
          <ul className="mt-3 divide-y divide-border">
            {c.themes.map((t) => (
              <li key={t.issue} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2 text-[13.5px]">
                <span className="text-ink">{t.issue}</span>
                <span className="tabular-nums text-ink-muted">
                  {t.count.toLocaleString()} complaints about {t.institutions} institutions, {t.from_year} to {t.to_year}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[12.5px] text-ink-muted">
          Counts cover institutions in the {PRODUCT_NAME}{c?.fetched_on ? `, as of ${c.fetched_on}` : ""}. The latest year is partial. Complaints are not a
          representative sample and are not verified findings; a larger institution draws more of them. Each record in the
          database shows the institution&rsquo;s response.{" "}
          <a href={block.source.url} target="_blank" rel="noopener noreferrer" className="font-medium text-brick underline underline-offset-2">
            {block.source.label}
          </a>
        </p>
      </div>
    </details>
  );
}

const STATUS: Record<RegulatoryStatus, { text: string; className: string }> = {
  effective: { text: "In effect", className: "bg-[#EAF0EC] text-below-market" },
  proposed: { text: "Proposed", className: "bg-surface-200 text-ink" },
  blocked: { text: "Blocked", className: "bg-brick/10 text-brick" },
  withdrawn: { text: "Withdrawn", className: "border border-border text-ink-muted" },
  repealed: { text: "Repealed, no effect", className: "bg-brick/10 text-brick" },
};

export function UpdatesBlock({ block, summaries }: { block: Extract<GuideBlock, { type: "updates" }>; summaries: FeeCategorySummary[] }) {
  return (
    <ul className="mt-5 space-y-3">
      {block.items.map((u) => (
        <li key={u.title} className="rounded-xl border border-border bg-surface-0 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS[u.status].className}`}>{STATUS[u.status].text}</span>
            <span className="text-[12px] text-ink-muted">{u.date}</span>
          </div>
          <p className="mt-2 text-[15px] font-semibold text-ink">{u.title}</p>
          <dl className="mt-2 grid gap-2 text-[13.5px] leading-relaxed sm:grid-cols-3">
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">What changed</dt>
              <dd className="text-ink-soft"><Prose text={u.changed} summaries={summaries} /></dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Who it affects</dt>
              <dd className="text-ink-soft"><Prose text={u.who} summaries={summaries} /></dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">What you can do</dt>
              <dd className="text-ink-soft"><Prose text={u.action} summaries={summaries} /></dd>
            </div>
          </dl>
          <a href={u.source.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[12.5px] font-medium text-brick underline underline-offset-2">
            {u.source.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * A section's few next steps as large choices, each with its own links, then the minor tips
 * in a quieter list. External links open in a new tab.
 */
export function ActionsBlock({ block, summaries }: { block: Extract<GuideBlock, { type: "actions" }>; summaries: FeeCategorySummary[] }) {
  return (
    <div className="mt-5">
      <ul className="grid gap-3 md:grid-cols-3">
        {block.actions.map((action) => (
          <li key={action.title} className="flex min-w-0 flex-col rounded-xl border border-border bg-surface-0 px-5 py-4 shadow-fi-1">
            <h3 className="text-[16px] font-semibold leading-snug text-ink">{action.title}</h3>
            <p className="mt-1.5 flex-1 text-[13.5px] leading-relaxed text-ink-soft">
              <Prose text={action.text} summaries={summaries} />
            </p>
            <ul className="mt-2 flex flex-col">
              {action.links.map((link) => {
                const external = link.href.startsWith("http");
                return (
                  <li key={link.href + link.label}>
                    <a
                      href={link.href}
                      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      className="inline-flex min-h-11 items-center gap-1 text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
                    >
                      {link.label}
                      {external && <span className="sr-only"> (opens in a new tab)</span>}
                      <span aria-hidden="true" className="text-ink-muted">{external ? "\u2197" : "\u203A"}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      {block.tips && (
        <div className="mt-4 rounded-lg border border-border bg-paper px-5 py-4">
          <p className="text-[13px] font-semibold text-ink">{block.tips.title}</p>
          <ul className="mt-2 space-y-1.5 text-[13.5px] leading-relaxed text-ink-soft">
            {block.tips.items.map((item) => (
              <li key={item} className="flex gap-2.5">
                <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-ink-muted" aria-hidden="true" />
                <Prose text={item} summaries={summaries} className="flex-1" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
