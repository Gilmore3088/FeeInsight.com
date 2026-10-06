// Auth-gated, renders live DB-backed data at request time; not statically prerendered.
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { layerDates, loadFeeWorkspace } from "@/lib/hamilton/fee-workspace-data";
import { buildAuditTrail } from "@/lib/hamilton/audit-trail";
import { parseLayer } from "@/lib/hamilton/research-layers";
import { peerPosition } from "@/lib/hamilton/fee-scenario";
import { buildImplementationPlan, earliestEffectiveDate } from "@/lib/hamilton/implementation-plan";
import { parseCount, parsePercent, parsePrices } from "@/lib/hamilton/model-params";
import { SITE_NAME } from "@/lib/constants";
import {
  AuditPanel,
  Callout,
  Figure,
  LinkButton,
  MemoHeader,
  MemoPage,
  MemoSection,
  SERIF,
  Tabs,
  fmtMoney,
  fmtSignedPrice,
} from "@/components/hamilton/memo/memo";
import { PrintButton } from "@/components/hamilton/memo/PrintButton";

export const metadata: Metadata = { title: "Plan a change" };

interface PageProps {
  searchParams: Promise<{
    fee?: string;
    from?: string;
    to?: string;
    notice?: string;
    format?: string;
    instId?: string;
    layer?: string;
    paid?: string;
    waiver?: string;
  }>;
}

const FORMATS = [
  { key: "plan", label: "Working plan" },
  { key: "one-pager", label: "CEO one-pager" },
  { key: "packet", label: "Pricing committee packet" },
] as const;
type Format = (typeof FORMATS)[number]["key"];

function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default async function PlanPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const ws = await loadFeeWorkspace({ userId: user.id, instId: params.instId, fee: params.fee, intent: "simulate" });
  const inst = ws.institution;
  const instId = inst ? String(inst.id) : null;
  const from = parsePrices(params.from)[0] ?? ws.ownAmount ?? 0;
  const to = parsePrices(params.to)[0];
  if (to === undefined) redirect(hrefWithInstitutionContext(`/pro/simulate?fee=${encodeURIComponent(ws.fee)}`, instId));

  const format: Format = FORMATS.some((f) => f.key === params.format) ? (params.format as Format) : "plan";
  const charter = inst?.charterType === "credit_union" ? "credit_union" : "bank";
  const plan = buildImplementationPlan({ feeCategory: ws.fee, feeLabel: ws.feeName, current: from, proposed: to, charter });
  const today = new Date().toISOString().slice(0, 10);
  const noticeDate = params.notice && /^\d{4}-\d{2}-\d{2}$/.test(params.notice) ? params.notice : today;
  const effective = earliestEffectiveDate(noticeDate, plan.advanceNoticeDays);
  const fee = ws.feeName.toLowerCase();
  const move =
    plan.direction === "eliminate"
      ? `Removing the ${fee} fee`
      : plan.direction === "none"
        ? `Keeping the ${fee} fee at ${fmtMoney(from)}`
        : `Moving the ${fee} fee from ${fmtMoney(from)} to ${fmtMoney(to)}`;

  const formatHref = (f: Format) => {
    const q = new URLSearchParams({ fee: ws.fee, from: String(from), to: String(to), notice: noticeDate, layer: mainLayer.key });
    if (params.paid) q.set("paid", params.paid);
    if (params.waiver) q.set("waiver", params.waiver);
    if (f !== "plan") q.set("format", f);
    return hrefWithInstitutionContext(`/pro/simulate/plan?${q.toString()}`, instId);
  };
  const modelHref = hrefWithInstitutionContext(`/pro/simulate?fee=${encodeURIComponent(ws.fee)}&prices=${to}`, instId);

  const paidItems = parseCount(params.paid);
  const waiverRate = parsePercent(params.waiver);
  const mainLayer = ws.layers.find((l) => l.key === parseLayer(params.layer)) ?? ws.layers[ws.layers.length - 1];
  const trail = buildAuditTrail({
    feeName: ws.feeName,
    layer: mainLayer,
    layerDates: layerDates(ws, mainLayer),
    extraLayers: ws.layers.filter((l) => l.n > 0).map((l) => ({ layer: l, dates: layerDates(ws, l) })),
    ownFeeRows: ws.ownFeeRows,
    local: ws.local,
    clientFigures: { paidItems, waiverRate },
    enteredBy: user.display_name || user.username,
    extraAssumptions: [
      `${fmtMoney(from)} is the starting price${ws.ownAmount === from ? ", your published fee" : ", as entered"}; ${fmtMoney(to)} is the price management is weighing.`,
      `Notice dates assume notice goes out on ${longDate(noticeDate)}.`,
      "Notice periods follow Reg DD (banks) or NCUA Truth in Savings (credit unions) for consumer accounts. Confirm with compliance.",
    ],
  });

  const layerRows = ws.layers
    .filter((l) => l.n > 0)
    .map((l) => ({ layer: l, now: peerPosition(l.amounts, from), after: peerPosition(l.amounts, to) }));

  const marketTable = (
    <div className="overflow-x-auto rounded-lg border border-warm-300 bg-warm-50">
      <table className="w-full min-w-[30rem] text-sm">
        <thead>
          <tr className="border-b border-warm-300 text-left text-xs uppercase tracking-[0.08em] text-warm-600">
            <th className="px-4 py-2 font-medium">Compared with</th>
            <th className="px-4 py-2 text-right font-medium">Middle</th>
            <th className="px-4 py-2 text-right font-medium">Charge less, at {fmtMoney(from)}</th>
            <th className="px-4 py-2 text-right font-medium">Charge less, at {fmtMoney(to)}</th>
          </tr>
        </thead>
        <tbody className="text-warm-800">
          {layerRows.map(({ layer, now, after }) => (
            <tr key={layer.key} className="border-b border-warm-200 last:border-0">
              <td className="px-4 py-2">
                {layer.label} <span className="text-warm-600">({layer.n})</span>
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(layer.median)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{now.less}</td>
              <td className="px-4 py-2 text-right tabular-nums">{after.less}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const timing = (
    <div className="grid grid-cols-2 gap-4 rounded-lg border border-warm-300 bg-warm-50 p-5 md:grid-cols-4">
      <Figure label="Change per item" value={fmtSignedPrice(to - from)} />
      <Figure label="Advance notice" value={plan.advanceNoticeDays > 0 ? `${plan.advanceNoticeDays} days` : "None required"} />
      <Figure label="Notice goes out" value={longDate(noticeDate)} />
      <Figure label="Earliest effective date" value={longDate(effective)} />
    </div>
  );

  const checklist = (
    <div className="grid gap-4 md:grid-cols-2">
      {plan.sections.map((s) => (
        <div key={s.title} className="rounded-lg border border-warm-300 bg-warm-50 p-5">
          <h3 className="text-lg text-warm-900" style={SERIF}>
            {s.title}
          </h3>
          <ul className="mt-2 flex flex-col gap-2 text-sm text-warm-800">
            {s.items.map((i) => (
              <li key={i.text} className="flex gap-2">
                <span aria-hidden className="mt-1 inline-block h-3 w-3 shrink-0 rounded-sm border border-warm-500" />
                <span className="min-w-0">
                  {i.text}
                  {i.rule ? (
                    <>
                      {" "}
                      <a href={i.rule.url} target="_blank" rel="noreferrer" className="whitespace-nowrap text-terra-text underline">
                        {i.rule.label}
                      </a>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );

  if (format !== "plan") {
    const title = format === "one-pager" ? "CEO one-pager" : "Pricing committee packet";
    return (
      <MemoPage>
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Tabs label="Format" items={FORMATS.map((f) => ({ label: f.label, href: formatHref(f.key), active: f.key === format }))} />
          <PrintButton />
        </div>
        <article className="flex flex-col gap-6 rounded-lg border border-warm-300 bg-white p-8 shadow-sm print:border-0 print:p-0 print:shadow-none">
          <header className="border-b border-warm-300 pb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-terra-text">
              {title} · {inst?.name ?? "Your institution"}
            </p>
            <h1 className="mt-1.5 text-3xl text-warm-900" style={SERIF}>
              {move}
            </h1>
            <p className="mt-2 text-sm text-warm-700">
              Prepared {longDate(today)} with Hamilton, the {SITE_NAME} Pro workspace. Market figures are published fees verified
              against each institution&apos;s own schedule.
            </p>
          </header>
          <section className="flex flex-col gap-2">
            <h2 className="text-xl text-warm-900" style={SERIF}>
              The decision in front of management
            </h2>
            <p className="text-pretty text-sm leading-relaxed text-warm-800">
              {move} changes each charged item by {fmtSignedPrice(to - from)}. {plan.noticeSummary}{" "}
              {plan.advanceNoticeDays > 0
                ? `With notice on ${longDate(noticeDate)}, the change can take effect on ${longDate(effective)} at the earliest.`
                : `It can take effect once disclosures are updated.`}
            </p>
          </section>
          {timing}
          <section className="flex flex-col gap-2">
            <h2 className="text-xl text-warm-900" style={SERIF}>
              Where the price would sit
            </h2>
            {marketTable}
          </section>
          {format === "packet" ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-xl text-warm-900" style={SERIF}>
                What it takes
              </h2>
              {checklist}
            </section>
          ) : (
            <section className="flex flex-col gap-2">
              <h2 className="text-xl text-warm-900" style={SERIF}>
                What it takes
              </h2>
              <p className="text-sm text-warm-800">
                {plan.sections.map((s) => `${s.title}: ${s.items.map((i) => i.text.toLowerCase()).join("; ")}.`).join(" ")}
              </p>
            </section>
          )}
          <section className="flex flex-col gap-2 break-inside-avoid">
            <h2 className="text-xl text-warm-900" style={SERIF}>
              Appendix: sources and method
            </h2>
            <AuditPanel trail={trail} open />
          </section>
          <p className="border-t border-warm-200 pt-3 text-xs text-warm-600">
            Fee income effects depend on the institution&apos;s own volume and waivers, which this document doesn&apos;t assume. This is
            research support, not legal advice; confirm notice terms with compliance.
          </p>
        </article>
      </MemoPage>
    );
  }

  return (
    <MemoPage>
      <MemoHeader
        kicker={`If management chooses · ${ws.feeName}`}
        title={move}
        dek="What the change takes once it's decided: approvals, customer notice, systems and the checks after launch."
        actions={<LinkButton href={modelHref}>Back to the prices</LinkButton>}
      />
      <MemoSection title="Timing">
        {timing}
        <form method="get" action="/pro/simulate/plan" className="flex flex-wrap items-end gap-3 text-sm text-warm-800">
          <input type="hidden" name="fee" value={ws.fee} />
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="to" value={to} />
          {instId ? <input type="hidden" name="instId" value={instId} /> : null}
          <label className="flex flex-col gap-1">
            Date notice goes out
            <input
              type="date"
              name="notice"
              defaultValue={noticeDate}
              className="rounded-md border border-warm-300 bg-white px-3 py-2 text-sm text-warm-900"
            />
          </label>
          <button type="submit" className="rounded-md border border-warm-300 bg-warm-50 px-3.5 py-2 font-medium hover:border-warm-500">
            Update dates
          </button>
        </form>
        <Callout>{plan.noticeSummary}</Callout>
      </MemoSection>
      <MemoSection title="Checklist">{checklist}</MemoSection>
      <MemoSection title="Where the price would sit" note="Institutions charging less than you, today and after the change.">
        {marketTable}
      </MemoSection>
      <AuditPanel trail={trail} />
      <MemoSection title="Turn this into" note="Ready to print or save as PDF, in the Fee Insight format.">
        <div className="flex flex-wrap gap-2">
          <LinkButton href={formatHref("one-pager")} primary>
            CEO one-pager
          </LinkButton>
          <LinkButton href={formatHref("packet")}>Pricing committee packet</LinkButton>
        </div>
      </MemoSection>
    </MemoPage>
  );
}
