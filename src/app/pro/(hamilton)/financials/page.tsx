export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { redirectWithoutPremium } from "@/lib/team-billing";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import { readFinancialPerformance } from "@/lib/hamilton/financial-performance-read";
import {
  FINANCIAL_PEER_MINIMUM,
  FINANCIAL_VIEW_MIN_QUARTERS,
  filedThousandsText,
  headlineSentence,
  isQuarterEnd,
  type FiledVariable,
  type FinancialPerformanceView,
  type FinancialQuarter,
  type MeasureCell,
} from "@/lib/hamilton/financial-quarters";
import { Figure, LinkButton, MemoHeader, MemoPage, MemoSection, QuarterLines } from "@/components/hamilton/memo/memo";

export const metadata: Metadata = { title: "Financial performance" };

const PATH = "/pro/financials";

function pct(value: number | null): string {
  if (value === null) return "n/a";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function money(value: number | null): string {
  return value === null ? "n/a" : filedThousandsText(value);
}

function peerText(cell: MeasureCell): string {
  if (cell.peerMedian !== null) return `${filedThousandsText(cell.peerMedian)} (${cell.peers} peers)`;
  return cell.peers > 0 ? `Too few peers (${cell.peers})` : "No peers reported";
}

const CHECK_TEXT: Record<FiledVariable["check"], string> = {
  matches: "Matches the filing",
  differs: "Does not match the filing",
  not_in_record: "Not in the stored filing",
};

const BASIS_TEXT: Record<FiledVariable["basis"], string> = {
  quarter: "One quarter",
  year_to_date: "Year to date",
  quarter_end_balance: "Balance at quarter end",
};

function dayText(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function Evidence({ quarter, open }: { quarter: FinancialQuarter; open: boolean }) {
  const e = quarter.evidence;
  return (
    <details id={`evidence-${quarter.reportDate}`} open={open} className="rounded-md border border-warm-300 bg-warm-50 px-4 py-3 text-sm">
      <summary className="flex min-h-11 cursor-pointer items-center font-medium text-warm-900 sm:min-h-0">
        {quarter.label} evidence
      </summary>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[10rem_1fr]">
        <dt className="text-warm-600">Filing entity</dt>
        <dd className="text-warm-900">{e.entity}</dd>
        <dt className="text-warm-600">Filing</dt>
        <dd className="text-warm-900">{e.form}</dd>
        <dt className="text-warm-600">Quarter end</dt>
        <dd className="text-warm-900">{dayText(e.quarterEnd)}</dd>
        <dt className="text-warm-600">Retrieved</dt>
        <dd className="text-warm-900">
          {e.retrievedAt ? dayText(e.retrievedAt) : "Not recorded"}
          {e.sourceUrl ? (
            <>
              {" · "}
              <a href={e.sourceUrl} className="text-terra-text underline" rel="noopener noreferrer" target="_blank">
                Source file
              </a>
            </>
          ) : null}
        </dd>
        <dt className="text-warm-600">Calculation</dt>
        <dd className="text-warm-900">
          {e.calculation}
          {e.heldReason ? <span className="mt-1 block text-warm-700">{e.heldReason}</span> : null}
        </dd>
      </dl>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-xs">
          <caption className="sr-only">Report variables for {quarter.label}</caption>
          <thead className="text-warm-600">
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">Variable</th>
              <th scope="col" className="py-1 pr-3 font-medium">Basis</th>
              <th scope="col" className="py-1 pr-3 font-medium">As filed</th>
              <th scope="col" className="py-1 pr-3 font-medium">Shown here</th>
              <th scope="col" className="py-1 font-medium">Check</th>
            </tr>
          </thead>
          <tbody className="text-warm-900 [font-variant-numeric:tabular-nums]">
            {e.variables.map((v) => (
              <tr key={v.code} className="border-t border-warm-200">
                <td className="py-1.5 pr-3">
                  <span className="font-mono">{v.code}</span> {v.name}
                </td>
                <td className="py-1.5 pr-3">{BASIS_TEXT[v.basis]}</td>
                <td className="py-1.5 pr-3">
                  {v.filed === null ? "n/a" : `${v.filed.toLocaleString("en-US")} ${v.rawUnit === "dollars" ? "dollars" : "thousand dollars"}`}
                </td>
                <td className="py-1.5 pr-3">{money(v.stored)}</td>
                <td className="py-1.5">{CHECK_TEXT[v.check]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function QuarterTable({ view, selected }: { view: FinancialPerformanceView; selected: string | null }) {
  const ncua = view.source === "ncua";
  const th = "px-3 py-2 font-medium";
  const td = "px-3 py-2";
  return (
    <div className="overflow-x-auto rounded-lg border border-warm-300">
      <table className="w-full min-w-[56rem] text-left text-sm">
        <caption className="sr-only">Filed quarters, newest first</caption>
        <thead className="bg-warm-100 text-xs text-warm-700">
          <tr>
            <th scope="col" className={th}>Quarter</th>
            <th scope="col" className={th}>{ncua ? "Fee income, quarter" : "Service charges, quarter"}</th>
            {ncua ? <th scope="col" className={th}>Fee income, year to date as filed</th> : null}
            <th scope="col" className={th}>vs prior quarter</th>
            <th scope="col" className={th}>vs year earlier</th>
            <th scope="col" className={th}>Peer median, quarter</th>
            <th scope="col" className={th}>Deposits at quarter end</th>
            <th scope="col" className={th}>Deposits vs year earlier</th>
            <th scope="col" className={th}>Assets at quarter end</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-warm-200 bg-warm-50 text-warm-900 [font-variant-numeric:tabular-nums]">
          {view.quarters.map((q) => (
            <tr key={q.reportDate} className={selected === q.reportDate ? "bg-terra-soft" : undefined}>
              <th scope="row" className={`${td} font-medium`}>
                <Link href={`${PATH}?quarter=${q.reportDate}#evidence-${q.reportDate}`} className="text-terra-text underline">
                  {q.label}
                </Link>
              </th>
              <td className={td}>{q.fee.value === null ? "Not shown" : filedThousandsText(q.fee.value)}</td>
              {ncua ? <td className={td}>{money(q.fee.yearToDate)}</td> : null}
              <td className={td}>{pct(q.fee.qoqPct)}</td>
              <td className={td}>{pct(q.fee.yoyPct)}</td>
              <td className={td}>{peerText(q.fee)}</td>
              <td className={td}>{money(q.deposits.value)}</td>
              <td className={td}>{pct(q.deposits.yoyPct)}</td>
              <td className={td}>{money(q.assets.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function FinancialsPage({
  searchParams,
}: {
  searchParams: Promise<{ instId?: string; quarter?: string }>;
}) {
  const params = await searchParams;
  const returnPath = params.instId ? `${PATH}?instId=${encodeURIComponent(params.instId)}` : PATH;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?from=${encodeURIComponent(returnPath)}`);
  await redirectWithoutPremium(user, returnPath);

  const { institution } = await resolveHamiltonInstitutionContext({ userId: user.id, instId: params.instId, intent: "financials" });

  if (!institution) {
    return (
      <MemoPage>
        <MemoHeader kicker="Your institution" title="Financial performance" dek="Choose your bank or credit union first, and its filed quarters show here." />
        <div>
          <LinkButton href="/pro/settings">Choose your institution</LinkButton>
        </div>
      </MemoPage>
    );
  }

  const { view, peerReadFailed } = await readFinancialPerformance(institution.id);
  const selected = params.quarter && isQuarterEnd(params.quarter) ? params.quarter : null;
  const kind = view?.source === "ncua" || institution.charterType === "credit_union" ? "credit unions" : "banks";
  const tier = institution.assetTierLabel ? ` in the ${institution.assetTierLabel} asset-size tier` : " of the same asset-size tier";

  if (!view || view.quarters.length === 0) {
    return (
      <MemoPage>
        <MemoHeader kicker={institution.name} title="Financial performance" />
        <p className="text-sm text-warm-700">No call report filings are on file for {institution.name} yet.</p>
      </MemoPage>
    );
  }

  const ncua = view.source === "ncua";
  const latest = view.quarters.find((q) => q.fee.value !== null) ?? view.quarters[0];
  const headline = headlineSentence(view);
  const oldestFirst = [...view.quarters].reverse();

  return (
    <MemoPage>
      <MemoHeader
        kicker={institution.name}
        title="Financial performance"
        dek={`${ncua ? "Fee income" : "Deposit service charges"}, deposits and assets from ${view.quarters.length} filed quarters, with the peer median for each quarter.`}
      />

      <MemoSection title="Latest quarter">
        {headline ? <p className="text-base leading-relaxed text-warm-900">{headline}</p> : null}
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <Figure label={`${ncua ? "Fee income" : "Service charges"}, ${latest.label}`} value={money(latest.fee.value)} />
          <Figure label="vs year earlier" value={pct(latest.fee.yoyPct)} />
          <Figure
            label="Peer median"
            value={money(latest.fee.peerMedian)}
            note={latest.fee.peerMedian === null ? `Shown when at least ${FINANCIAL_PEER_MINIMUM} peers report` : `${latest.fee.peers} peers`}
          />
          <Figure label={`Deposits, ${latest.label}`} value={money(latest.deposits.value)} />
        </div>
      </MemoSection>

      <MemoSection
        title={`${ncua ? "Fee income" : "Service charges"} by quarter`}
        note="Each quarter alone, beside the peer median for the same quarter. A gap means the quarter could not be shown."
      >
        <QuarterLines
          quarters={oldestFirst.map((q) => q.key)}
          series={[
            { label: institution.name, values: oldestFirst.map((q) => q.fee.value), own: true },
            { label: "Peer median", values: oldestFirst.map((q) => q.fee.peerMedian) },
          ]}
        />
      </MemoSection>

      <MemoSection
        title="Quarter by quarter"
        note="Open a quarter to see the filing, its report variables and the calculation."
      >
        <QuarterTable view={view} selected={selected} />
        <ul className="flex flex-col gap-1 text-xs leading-relaxed text-warm-700">
          {ncua ? (
            <li>
              Credit unions file fee income year to date. The quarter column is the year to date less the previous
              quarter&apos;s; the first quarter stands as filed. The year-to-date column is the filed total and is never a
              single quarter.
            </li>
          ) : (
            <li>Banks file service charges on deposit accounts for each quarter, so no conversion is needed.</li>
          )}
          <li>Deposits and assets are balances at quarter end. Dollar figures are filed in thousands.</li>
          <li>
            Peers are other {kind}{tier} that filed for the same quarter. A peer median shows only when at
            least {FINANCIAL_PEER_MINIMUM} peers report the figure.
            {peerReadFailed ? " Peer figures could not be read just now." : ""}
          </li>
          {view.short ? (
            <li>
              Only {view.quarters.length} quarters are on file; the full view covers {FINANCIAL_VIEW_MIN_QUARTERS} to 12.
            </li>
          ) : null}
        </ul>
      </MemoSection>

      <MemoSection title="Evidence for each quarter">
        <div className="flex flex-col gap-2">
          {view.quarters.map((q) => (
            <Evidence key={q.reportDate} quarter={q} open={selected === q.reportDate} />
          ))}
        </div>
      </MemoSection>
    </MemoPage>
  );
}
