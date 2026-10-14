import Link from "next/link";
import { formatWireDate, wireHref, parseWireParams } from "@/lib/regulatory/wire";
import { FEE_TYPE_LABELS } from "@/lib/regulatory/wire-fee-types";
import { stateReportHref } from "@/lib/regulatory/wire-fee-links";
import type { DigestItem, DigestSection, WireDigest } from "@/lib/regulatory/wire-digest";

/**
 * The weekly Regulatory Wire digest as a page: watched states, then the federal agencies,
 * each grouped by kind. Server-rendered, no client JavaScript. It says plainly that the
 * digest is not emailed.
 */

const LABEL = "text-[10px] font-bold uppercase tracking-[0.1em] text-warm-600";
const SANS = { fontFamily: "var(--hamilton-font-sans)" } as const;
const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" } as const;

const BADGE: Record<DigestItem["kind"], { text: string; className: string }> = {
  bill: { text: "Bill", className: "bg-[#C44B2E] text-white" },
  regulator: { text: "Regulator", className: "bg-warm-900 text-white" },
  press: { text: "Press", className: "border border-dashed border-warm-500 text-warm-700" },
  federal: { text: "Release", className: "bg-warm-800 text-white" },
};

function day(value: string | null, now: Date): string {
  return formatWireDate(value, now)?.absolute ?? "Date not given";
}

function ItemRow({ item, now, exampleSummaries }: { item: DigestItem; now: Date; exampleSummaries: boolean }) {
  const badge = BADGE[item.kind];
  const title = (
    <span className={item.kind === "press" ? "text-warm-700" : "text-warm-900"}>{item.title}</span>
  );
  return (
    <li className="py-3">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
        <span className={`rounded px-1.5 py-0.5 font-bold uppercase tracking-wider ${badge.className}`}>
          {badge.text}
          {item.kind === "press" && item.publisher ? <span className="normal-case tracking-normal"> · {item.publisher}</span> : null}
        </span>
        {item.identifier ? <span className="font-semibold text-warm-700 [font-variant-numeric:tabular-nums]">{item.identifier}</span> : null}
        {item.feeTypes.length > 0 ? (
          <span className="font-semibold text-[#A93D25]">{item.feeTypes.map((f) => FEE_TYPE_LABELS[f]).join(", ")}</span>
        ) : null}
        <span className="text-warm-600 [font-variant-numeric:tabular-nums]">
          {item.kind === "bill" ? "Latest action " : ""}
          {day(item.date, now)}
          {item.stage ? ` · ${item.stage}` : ""}
        </span>
      </p>
      <h3 className="mt-1 text-[16px] font-medium leading-snug" style={SERIF}>
        {item.url && /^https?:\/\//i.test(item.url) ? (
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="no-underline hover:text-[#A93D25]">
            {title}
          </a>
        ) : (
          title
        )}
      </h3>
      {item.summary ? (
        <div className="mt-1.5 rounded-md border border-warm-200 bg-warm-100/60 px-2.5 py-1.5">
          <p className={LABEL} style={SANS}>
            {exampleSummaries ? "EXAMPLE · " : ""}AI summary of the source text
          </p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-warm-900">{item.summary}</p>
        </div>
      ) : null}
    </li>
  );
}

function Section({ section, now, exampleSummaries }: { section: DigestSection; now: Date; exampleSummaries: boolean }) {
  const federal = section.jurisdiction === "federal";
  const base = parseWireParams({}, () => false);
  const wireLink = federal
    ? wireHref({ ...base, range: "week" })
    : wireHref({ ...base, view: "states", state: section.jurisdiction, range: "week" });
  return (
    <section aria-label={section.name} className="rounded-xl border border-warm-200 bg-white/70 px-4 py-3.5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="text-[1.25rem] leading-tight text-warm-900" style={SERIF}>
          {section.name}
        </h2>
        <p className="text-[12px] text-warm-600 [font-variant-numeric:tabular-nums]">
          {section.total === 0 ? "Nothing new this week" : `${section.total.toLocaleString()} ${section.total === 1 ? "item" : "items"} this week`}
        </p>
      </div>
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px]">
        <Link href={wireLink} className="font-semibold text-[#A93D25] no-underline hover:underline">
          Open in the Wire →
        </Link>
        {federal ? null : (
          <Link href={stateReportHref(section.jurisdiction)} className="font-semibold text-[#A93D25] no-underline hover:underline">
            {section.name} fee report →
          </Link>
        )}
      </p>
      {section.groups.map((group) => (
        <div key={group.label} className="mt-3">
          <h3 className={LABEL} style={SANS}>
            {group.label} · {group.items.length}
          </h3>
          <ol className="divide-y divide-warm-200/70">
            {group.items.map((item, i) => (
              <ItemRow key={`${item.url ?? item.title}-${i}`} item={item} now={now} exampleSummaries={exampleSummaries} />
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

export function DigestView({
  digest,
  now,
  failed = [],
  exampleSummaries = false,
}: {
  digest: WireDigest;
  now: Date;
  /** Parts that could not be read. */
  failed?: string[];
  /** Preview only: summaries were written by hand and are labelled EXAMPLE. */
  exampleSummaries?: boolean;
}) {
  const noStates = digest.states.length === 0;
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <header>
        <p className={LABEL} style={SANS}>
          <Link href="/pro/news" className="text-warm-600 no-underline hover:text-[#A93D25]">
            Regulatory Wire
          </Link>{" "}
          · Weekly digest
        </p>
        <h1 className="mt-1 text-[1.75rem] leading-[1.12] tracking-[-0.02em] text-[#1A1815] sm:text-[2.25rem]" style={SERIF}>
          Your week on the Wire
        </h1>
        <p className="mt-1 text-[13px] text-warm-600 [font-variant-numeric:tabular-nums]">
          {noStates ? "The federal agencies" : `${digest.states.length === 1 ? "Your watched state" : "Your watched states"} and the federal agencies`}, {day(digest.since, now)} to{" "}
          {day(digest.until, now)}: {digest.total.toLocaleString()} {digest.total === 1 ? "item" : "items"}
          {digest.summaries > 0 ? `, ${digest.summaries} with an AI summary` : ""}.
        </p>
      </header>

      <div role="note" className="mt-4 rounded-lg border border-[#C44B2E]/40 bg-white px-3 py-2.5 text-[12px] leading-relaxed text-warm-700">
        <strong className="font-semibold text-warm-900">Not emailed yet.</strong> This page is the digest: it is built from the Wire each
        time you open it, and nothing is sent to your inbox. Email delivery is switched off for now.
      </div>

      {noStates ? (
        <p className="mt-4 rounded-lg border border-warm-200 bg-white/70 px-3 py-2.5 text-[13px] text-warm-700">
          You don&apos;t watch any states yet. Open a state on the{" "}
          <Link href="/pro/news?view=states" className="font-semibold text-[#A93D25] no-underline hover:underline">
            States view
          </Link>{" "}
          and choose <span className="font-semibold">Watch this state</span>; it will appear here with its bills, regulator posts and press.
        </p>
      ) : null}

      {failed.length > 0 ? (
        <p role="status" className="mt-4 rounded-lg border border-warm-300 bg-warm-150 px-3 py-2 text-[12px] text-warm-700">
          {failed.join(" and ")} could not be read just now, so they are missing from this digest.
        </p>
      ) : null}

      <div className="mt-5 space-y-4">
        {digest.sections.map((section) => (
          <Section key={section.jurisdiction} section={section} now={now} exampleSummaries={exampleSummaries} />
        ))}
      </div>

      <p className="mt-5 text-[11px] leading-relaxed text-warm-600">
        Items are dated by publication or, for bills, the latest action (UTC), in the last 7 days. Fee types come from keywords in
        the headline. AI summaries are written by a model from the item&apos;s own text where one has been written; they can be
        wrong, and the source is what counts. Press stories are the outlet&apos;s reporting and are never summarised.
      </p>
    </div>
  );
}
