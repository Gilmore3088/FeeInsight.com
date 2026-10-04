import Link from "next/link";
import { ProLock } from "@/components/public/pro-lock";

const CARD_LINK =
  "group flex flex-col rounded-xl border border-[#E8DFD1]/80 px-5 py-4 transition-all hover:border-[#C44B2E]/20 hover:bg-[#FAF7F2] hover:shadow-md hover:shadow-[#C44B2E]/5";

export function OriginalResearchSection() {
  return (
    <section className="mt-10" id="original-research">
      <h2
        className="text-sm font-bold text-[#1A1815]"
        style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
      >
        Original Research
      </h2>
      <p className="mt-1 text-[13px] text-[#6B6255]">
        In-depth studies and analysis on US bank fee structures.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Link
          href="/research/fee-revenue-analysis"
          className={CARD_LINK}
        >
          <div className="flex items-start gap-3">
            <svg
              className="mt-0.5 h-5 w-5 shrink-0 text-[#6B6255] group-hover:text-[#C44B2E] transition-colors"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75"
              />
            </svg>
            <div>
              <span className="text-sm font-semibold text-[#1A1815] group-hover:text-[#A93D25] transition-colors">
                Fee-to-Revenue Analysis
              </span>{" "}
              <ProLock className="ml-1 align-middle" />
              <span className="mt-1 block text-[13px] leading-relaxed text-[#6B6255]">
                How published fee schedules correlate with service charge
                income reported in FDIC call reports.
              </span>
            </div>
          </div>
          <span className="mt-3 self-end text-[11px] font-medium text-[#A93D25] opacity-0 group-hover:opacity-100 transition-opacity">
            View study &rarr;
          </span>
        </Link>

        <Link
          href="/research/market-concentration"
          className={CARD_LINK}
        >
          <div className="flex items-start gap-3">
            <svg
              className="mt-0.5 h-5 w-5 shrink-0 text-[#6B6255] group-hover:text-[#C44B2E] transition-colors"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5"
              />
            </svg>
            <div>
              <span className="text-sm font-semibold text-[#1A1815] group-hover:text-[#A93D25] transition-colors">
                Market Concentration & Fees
              </span>{" "}
              <ProLock className="ml-1 align-middle" />
              <span className="mt-1 block text-[13px] leading-relaxed text-[#6B6255]">
                HHI analysis of deposit market competition across U.S. metro
                areas using FDIC Summary of Deposits data.
              </span>
            </div>
          </div>
          <span className="mt-3 self-end text-[11px] font-medium text-[#A93D25] opacity-0 group-hover:opacity-100 transition-opacity">
            View study &rarr;
          </span>
        </Link>

        <Link
          href="/guides"
          className={CARD_LINK}
        >
          <div className="flex items-start gap-3">
            <svg
              className="mt-0.5 h-5 w-5 shrink-0 text-[#6B6255] group-hover:text-[#C44B2E] transition-colors"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
              />
            </svg>
            <div>
              <span className="text-sm font-semibold text-[#1A1815] group-hover:text-[#A93D25] transition-colors">
                Consumer Guides
              </span>
              <span className="mt-1 block text-[13px] leading-relaxed text-[#6B6255]">
                Plain-language guides to understanding overdraft, NSF, ATM,
                wire transfer, and maintenance fees with live benchmarks.
              </span>
            </div>
          </div>
          <span className="mt-3 self-end text-[11px] font-medium text-[#A93D25] opacity-0 group-hover:opacity-100 transition-opacity">
            Browse guides &rarr;
          </span>
        </Link>
      </div>
    </section>

  );
}
