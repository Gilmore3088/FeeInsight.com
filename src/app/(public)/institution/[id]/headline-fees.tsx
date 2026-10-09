import Link from "next/link";
import { formatFeeAmount } from "@/lib/format";
import { otherRange, sourcePageLabel, type HeadlineLine, type HeadlineLines, type HeadlineRow } from "./profile-data";

const SERIF_STYLE = { fontFamily: "var(--font-newsreader), Georgia, serif" } as const;
const LINK_CLASS =
  "inline-flex min-h-6 items-center font-semibold text-[#A93D25] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A93D25]";

interface LineSpec {
  key: keyof HeadlineLines;
  category: string;
  label: string;
  /** What the other rows are called: "accounts" for monthly fees, "amounts" otherwise. */
  othersNoun: string;
}

const LINES: LineSpec[] = [
  { key: "overdraft", category: "overdraft", label: "Overdraft", othersNoun: "amounts" },
  { key: "nsf", category: "nsf", label: "NSF / returned item", othersNoun: "amounts" },
  { key: "monthly", category: "monthly_maintenance", label: "Monthly maintenance", othersNoun: "accounts" },
];

/** "From $5" when other accounts cost more, else the amount alone. */
function leadAmount(spec: LineSpec, line: HeadlineLine): string {
  const amount = formatFeeAmount(line.pick.amount) ?? "";
  if (line.high === line.low) return amount;
  return spec.key === "monthly" ? `From ${amount}` : `Up to ${amount}`;
}

/** Who the amount belongs to: the account for monthly fees, the fee's own name otherwise. */
function WhoItIsFor({ spec, row }: { spec: LineSpec; row: HeadlineRow }) {
  if (spec.key !== "monthly") return <p className="mt-1 text-sm text-[#3D3830]">{row.feeName}</p>;
  if (row.account) {
    return (
      <p className="mt-1 text-sm text-[#3D3830]">
        For <span className="font-semibold text-[#1A1815]">{row.account}</span>
      </p>
    );
  }
  const page = sourcePageLabel(row.sourceUrl);
  return (
    <p className="mt-1 text-sm text-[#3D3830]">
      {row.feeName}. The record does not name the account
      {page && row.sourceUrl ? (
        <>
          ; it was read from{" "}
          <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer" className={`${LINK_CLASS} [overflow-wrap:anywhere]`}>
            {page}
          </a>
        </>
      ) : null}
      .
    </p>
  );
}

function Waiver({ row }: { row: HeadlineRow }) {
  const parts = [
    row.minBalanceToAvoid !== null ? `Waived with a ${formatFeeAmount(row.minBalanceToAvoid)} balance.` : null,
    row.waiverText ? `Waiver: ${row.waiverText}.` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <p className="mt-1 text-xs leading-relaxed text-[#5A5347]">{parts.join(" ")}</p>;
}

function OtherRows({ spec, line, compareHref }: { spec: LineSpec; line: HeadlineLine; compareHref: string }) {
  if (line.others.length === 0) return null;
  const count = line.others.length + 1;
  return (
    <div className="mt-2 border-t border-[#E0D7C9] pt-2 text-xs leading-relaxed text-[#5A5347]">
      <p>
        Other {spec.othersNoun} {otherRange(line)}:
      </p>
      <ul className="mt-1 space-y-0.5">
        {line.others.map((row) => (
          <li key={row.id} className="flex justify-between gap-3">
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {spec.key === "monthly" ? row.account ?? `${row.feeName} (account not named)` : row.feeName}
            </span>
            <span className="shrink-0 tabular-nums text-[#1A1815]">{formatFeeAmount(row.amount)}</span>
          </li>
        ))}
      </ul>
      <Link href={compareHref} scroll={false} className={`${LINK_CLASS} mt-1 text-xs`}>
        Compare all {count} in the fee table
      </Link>
    </div>
  );
}

/**
 * The amounts the page title and search summary lead with, each with the account or fee
 * behind it and, when the institution charges other amounts on the same line, those too.
 * The rule that picks them is pickHeadlineLines (profile-data.ts), stated on /methodology.
 */
export function HeadlineFees({ institutionId, lines }: { institutionId: number; lines: HeadlineLines }) {
  const present = LINES.filter((spec) => lines[spec.key] !== null);
  if (present.length === 0) return null;
  return (
    <div className="border-b border-[#E0D7C9] bg-[#FDFBF8] px-4 py-4 sm:px-5" aria-labelledby="headline-fees-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="headline-fees-heading" className="text-sm font-semibold text-[#1A1815]">
          Headline fees
        </h3>
        <Link href="/methodology#headline-fees" className={`${LINK_CLASS} text-xs`}>
          How headline fees are chosen
        </Link>
      </div>
      <dl className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {present.map((spec) => {
          const line = lines[spec.key] as HeadlineLine;
          return (
            <div key={spec.key} className="min-w-0 border border-[#E0D7C9] bg-white px-4 py-3">
              <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">{spec.label}</dt>
              <dd className="mt-1">
                <p className="text-2xl tabular-nums text-[#1A1815]" style={SERIF_STYLE}>
                  {leadAmount(spec, line)}
                </p>
                <WhoItIsFor spec={spec} row={line.pick} />
                <Waiver row={line.pick} />
                <OtherRows
                  spec={spec}
                  line={line}
                  compareHref={`/institution/${institutionId}?fee=${spec.category}`}
                />
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
