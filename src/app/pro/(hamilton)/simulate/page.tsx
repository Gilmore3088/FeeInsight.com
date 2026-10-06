// Auth-gated, renders live DB-backed data at request time; not statically prerendered.
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { layerDates, loadFeeWorkspace } from "@/lib/hamilton/fee-workspace-data";
import { buildAuditTrail } from "@/lib/hamilton/audit-trail";
import { parseLayer } from "@/lib/hamilton/research-layers";
import { modelScenario } from "@/lib/hamilton/fee-scenario";
import { buildImplementationPlan } from "@/lib/hamilton/implementation-plan";
import { defaultPrices, parseCount, parsePercent, parsePrices } from "@/lib/hamilton/model-params";
import { getHamiltonScenarioById } from "@/lib/hamilton/pro-tables";
import {
  AuditPanel,
  Callout,
  DistributionBars,
  Exhibit,
  LinkButton,
  MemoHeader,
  MemoPage,
  MemoSection,
  PeerSplitBars,
  PriceStrip,
  Tabs,
  fmtMoney,
  fmtSignedMoney,
  fmtSignedPrice,
} from "@/components/hamilton/memo/memo";

export const metadata: Metadata = { title: "Try a price" };

interface PageProps {
  searchParams: Promise<{
    fee?: string;
    category?: string;
    prices?: string;
    layer?: string;
    paid?: string;
    waiver?: string;
    instId?: string;
    scenario?: string;
    scenario_id?: string;
  }>;
}

const inputClass =
  "w-full rounded-md border border-warm-300 bg-white px-3 py-2 text-sm text-warm-900 focus:border-terra focus:outline-none focus:ring-1 focus:ring-terra";

export default async function ModelPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/");

  // Saved scenarios from the old Scenario screen open here with their fee and price.
  const scenarioId = params.scenario_id || params.scenario;
  const saved = scenarioId ? await getHamiltonScenarioById(scenarioId, user.id).catch(() => null) : null;

  const ws = await loadFeeWorkspace({
    userId: user.id,
    instId: params.instId ?? saved?.institution_id ?? null,
    fee: params.fee ?? params.category ?? saved?.fee_category ?? null,
    intent: "simulate",
  });
  const inst = ws.institution;
  const instId = inst ? String(inst.id) : null;
  const layerKey = parseLayer(params.layer ?? (ws.layers.some((l) => l.key === "local") ? "local" : "state"));
  const layer = ws.layers.find((l) => l.key === layerKey) ?? ws.layers[ws.layers.length - 1];

  const current = ws.ownAmount;
  const paidItems = parseCount(params.paid);
  const waiverRate = parsePercent(params.waiver);
  const typed = parsePrices(params.prices);
  const prices = typed.length
    ? typed
    : saved
      ? [Number(saved.proposed_value)]
      : defaultPrices(current, layer.median);
  const base = current ?? 0;
  const charter = inst?.charterType === "credit_union" ? "credit_union" : "bank";

  const columns = [
    ...(current != null ? [{ label: "Today", price: current, today: true }] : []),
    ...prices.map((p) => ({ label: p === 0 ? "No fee" : fmtMoney(p), price: p, today: false })),
  ].map((c) => ({
    ...c,
    result: modelScenario(layer.amounts, base, c.price, { paidItems, waiverRate }),
    plan: buildImplementationPlan({ feeCategory: ws.fee, feeLabel: ws.feeName, current: base, proposed: c.price, charter }),
  }));

  const hrefFor = (over: Record<string, string>) => {
    const q = new URLSearchParams();
    q.set("fee", ws.fee);
    q.set("layer", layer.key);
    if (params.prices) q.set("prices", params.prices);
    if (params.paid) q.set("paid", params.paid);
    if (params.waiver) q.set("waiver", params.waiver);
    for (const [k, v] of Object.entries(over)) q.set(k, v);
    return hrefWithInstitutionContext(`/pro/simulate?${q.toString()}`, instId);
  };
  const planHref = (price: number) =>
    hrefWithInstitutionContext(
      `/pro/simulate/plan?fee=${encodeURIComponent(ws.fee)}&from=${base}&to=${price}&layer=${layer.key}` +
        (params.paid ? `&paid=${encodeURIComponent(params.paid)}` : "") +
        (params.waiver ? `&waiver=${encodeURIComponent(params.waiver)}` : ""),
      instId,
    );
  const researchHref = hrefWithInstitutionContext(`/pro/research?fee=${encodeURIComponent(ws.fee)}&layer=${layer.key}`, instId);
  const trail = buildAuditTrail({
    feeName: ws.feeName,
    layer,
    layerDates: layerDates(ws, layer),
    ownFeeRows: ws.ownFeeRows,
    local: layer.key === "local" ? ws.local : null,
    clientFigures: { paidItems, waiverRate },
    enteredBy: user.display_name || user.username,
    extraAssumptions: [
      current != null ? `Today's price is your published ${ws.feeName.toLowerCase()} fee, ${fmtMoney(current)}.` : "No published price for you, so each change is measured from $0.",
      "Volume held steady at every price: Hamilton doesn't estimate how customers respond from public data.",
      "Notice periods follow Reg DD (banks) or NCUA Truth in Savings (credit unions) for consumer accounts.",
    ],
  });
  const csvHref = hrefWithInstitutionContext(`/pro/research/peers?fee=${encodeURIComponent(ws.fee)}&layer=${layer.key}`, instId);

  const row = "border-b border-warm-200";
  const head = "px-4 py-2.5 text-left text-xs font-medium uppercase tracking-[0.08em] text-warm-600";
  const cell = "px-4 py-2.5 text-right [font-variant-numeric:tabular-nums]";

  return (
    <MemoPage>
      <MemoHeader
        kicker={`Try a price · ${ws.feeName}`}
        title={`Test any ${ws.feeName.toLowerCase()} price side by side`}
        dek={
          current != null
            ? `Today you charge ${fmtMoney(current)}. Add the prices you want to test, including no fee at all. Hamilton shows where each would sit and what it does to fee income; it doesn't pick one.`
            : `We haven't published a ${ws.feeName.toLowerCase()} fee for ${inst?.name ?? "your institution"} yet, so each price is measured from $0. Add your current price below to change that.`
        }
        actions={<LinkButton href={researchHref}>Back to my fees</LinkButton>}
      />

      {ws.ownFees.length > 0 ? (
        <Tabs
          label="Fee"
          items={ws.ownFees.slice(0, 10).map((f) => ({
            label: f.name,
            meta: fmtMoney(f.amount),
            href: hrefWithInstitutionContext(`/pro/simulate?fee=${encodeURIComponent(f.category)}&layer=${layer.key}`, instId),
            active: f.category === ws.fee,
          }))}
        />
      ) : null}

      <form id="your-figures" method="get" action="/pro/simulate" className="grid scroll-mt-24 gap-4 rounded-lg border border-warm-300 bg-warm-50 p-5 md:grid-cols-4">
        <input type="hidden" name="fee" value={ws.fee} />
        {instId ? <input type="hidden" name="instId" value={instId} /> : null}
        <label className="flex flex-col gap-1 text-sm text-warm-800 md:col-span-2">
          Prices to test
          <input name="prices" defaultValue={prices.join(", ")} className={inputClass} placeholder="0, 25, 35" />
          <span className="text-xs text-warm-600">Up to four, separated by commas. 0 means no fee.</span>
        </label>
        <label className="flex flex-col gap-1 text-sm text-warm-800">
          Compare against
          <select name="layer" defaultValue={layer.key} className={inputClass}>
            {ws.layers.map((l) => (
              <option key={l.key} value={l.key}>
                {l.label} ({l.n})
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button type="submit" className="w-full rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark">
            Update
          </button>
        </div>
        <label className="flex flex-col gap-1 text-sm text-warm-800 md:col-span-2">
          Items you charge a year (your figure)
          <input id="paid" name="paid" inputMode="numeric" defaultValue={params.paid ?? ""} className={inputClass} placeholder="For example 14,500" />
        </label>
        <label className="flex flex-col gap-1 text-sm text-warm-800 md:col-span-2">
          Share you waive or refund, in percent (your figure)
          <input name="waiver" inputMode="decimal" defaultValue={params.waiver ?? ""} className={inputClass} placeholder="For example 12" />
        </label>
        <p className="text-xs text-warm-600 md:col-span-4">
          Your figures stay in this page&apos;s link and aren&apos;t saved anywhere yet. Without them Hamilton shows the change per 1,000 items
          rather than guessing your volume.
        </p>
      </form>

      <MemoSection title="Side by side" note={`Against ${layer.label.toLowerCase() === "national" ? "every institution nationally" : layer.label}: ${layer.scope} (${layer.n}).`}>
        <div className="flex flex-col gap-6 rounded-lg border border-warm-300 bg-warm-50 p-5">
          <PriceStrip
            amounts={layer.amounts}
            scopeLabel={layer.key === "national" ? "the nation" : layer.key === "peers" ? "your peer group" : layer.label}
            marks={columns.map((c) => ({ label: c.today ? `Today ${fmtMoney(c.price)}` : c.label, price: c.price, today: c.today }))}
          />
          <PeerSplitBars
            rows={columns.map((c) => ({
              label: c.today ? `Today ${fmtMoney(c.price)}` : c.label,
              today: c.today,
              less: c.result.peersLess,
              same: c.result.peersSame,
              more: c.result.peersMore,
              note: c.today
                ? "Your price today"
                : c.result.annualDelta != null
                  ? `${fmtSignedMoney(c.result.annualDelta)} a year`
                  : `${fmtSignedMoney(c.result.per1000Delta)} per 1,000 items`,
            }))}
          />
        </div>
        <div className="overflow-x-auto rounded-lg border border-warm-300 bg-warm-50">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className={row}>
                <th className={head} scope="col">
                  <span className="sr-only">Measure</span>
                </th>
                {columns.map((c) => (
                  <th key={c.label} scope="col" className={`${head} text-right ${c.today ? "text-terra-text" : ""}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-warm-800">
              <tr className={row}>
                <th scope="row" className="px-4 py-2.5 text-left font-normal">Change per item</th>
                {columns.map((c) => (
                  <td key={c.label} className={cell}>{c.today ? "—" : fmtSignedPrice(c.price - base)}</td>
                ))}
              </tr>
              <tr className={row}>
                <th scope="row" className="px-4 py-2.5 text-left font-normal">Charge less</th>
                {columns.map((c) => (
                  <td key={c.label} className={cell}>{c.result.peersLess} of {c.result.n}</td>
                ))}
              </tr>
              <tr className={row}>
                <th scope="row" className="px-4 py-2.5 text-left font-normal">Charge the same</th>
                {columns.map((c) => (
                  <td key={c.label} className={cell}>{c.result.peersSame}</td>
                ))}
              </tr>
              <tr className={row}>
                <th scope="row" className="px-4 py-2.5 text-left font-normal">Charge more</th>
                {columns.map((c) => (
                  <td key={c.label} className={cell}>{c.result.peersMore}</td>
                ))}
              </tr>
              <tr className={row}>
                <th scope="row" className="px-4 py-2.5 text-left font-normal">Fee income per 1,000 items, before waivers</th>
                {columns.map((c) => (
                  <td key={c.label} className={cell}>{c.today ? "—" : fmtSignedMoney(c.result.per1000Delta)}</td>
                ))}
              </tr>
              <tr className={row}>
                <th scope="row" className="px-4 py-2.5 text-left font-normal">Fee income a year, from your figures</th>
                {columns.map((c) => (
                  <td key={c.label} className={cell}>
                    {c.today ? "—" : c.result.annualDelta != null ? fmtSignedMoney(c.result.annualDelta) : <a href="#your-figures" className="text-terra-text underline">Add your figures</a>}
                  </td>
                ))}
              </tr>
              <tr className={row}>
                <th scope="row" className="px-4 py-2.5 text-left font-normal">Notice before it takes effect</th>
                {columns.map((c) => (
                  <td key={c.label} className={cell}>
                    {c.today ? "—" : c.plan.advanceNoticeDays > 0 ? `${c.plan.advanceNoticeDays} days` : "None required"}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row" className="px-4 py-2.5 text-left font-normal">
                  <span className="sr-only">Plan</span>
                </th>
                {columns.map((c) => (
                  <td key={c.label} className={cell}>
                    {c.today ? null : (
                      <a href={planHref(c.price)} className="text-terra-text underline">
                        If management chooses this
                      </a>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <Callout>
          These figures hold volume steady. Customers may overdraw less, or move, when a price changes; Hamilton doesn&apos;t estimate that
          from public data. Your own history of items charged and waived is the best guide.
        </Callout>
      </MemoSection>

      <Exhibit
        number={1}
        title={`${ws.feeName} prices, ${layer.label}`}
        source={`${layer.scope}. Published fees verified against each institution's own fee schedule; one value per institution.`}
      >
        <DistributionBars amounts={layer.amounts} own={current} tested={prices.length === 1 ? prices[0] : null} />
      </Exhibit>

      <AuditPanel trail={trail} downloadHref={csvHref} />

      <p className="text-xs text-warm-600">
        Change the comparison: {ws.layers.map((l, i) => (
          <span key={l.key}>
            {i > 0 ? " · " : ""}
            <a href={hrefFor({ layer: l.key })} className={l.key === layer.key ? "font-semibold text-warm-900" : "text-terra-text underline"}>
              {l.label}
            </a>
          </span>
        ))}
      </p>
    </MemoPage>
  );
}
