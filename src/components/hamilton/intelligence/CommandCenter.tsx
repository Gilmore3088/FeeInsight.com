import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { buildCommandCenter, commandCenterQuarter, type CommandCenterAnswer } from "@/lib/hamilton/command-center";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { readFinancialPerformance } from "@/lib/hamilton/financial-performance-read";
import { COMPETITOR_MOVE_WINDOW_DAYS } from "@/lib/hamilton/workspace/research";
import { STATE_NAMES } from "@/lib/us-states";
import { MemoHeader, SERIF } from "@/components/hamilton/memo/memo";
import { getQuarterlyChangesOnce, loadBriefingOnce } from "./InstitutionBriefing";

/** One question and its answer: a row of the command center, never a card on its own. */
export function CommandCenterRow({ answer }: { answer: CommandCenterAnswer }) {
  return (
    <section
      aria-labelledby={`cc-${answer.key}`}
      className="grid gap-2 border-t border-warm-300 py-5 first:border-t-0 sm:grid-cols-[14rem_1fr] sm:gap-6"
    >
      <h2 id={`cc-${answer.key}`} className="text-lg font-semibold leading-snug text-warm-900" style={SERIF}>
        {answer.question}
      </h2>
      <div className="flex min-w-0 flex-col gap-2">
        {answer.lines.map((line, i) => (
          <p key={i} className="text-pretty text-[15px] leading-relaxed text-warm-900 [font-variant-numeric:tabular-nums]">
            {line}
          </p>
        ))}
        {answer.source ? <p className="text-xs leading-snug text-warm-600">Source: {answer.source}</p> : null}
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {answer.links.map((link) => (
            <Link key={link.href} href={link.href} className="inline-flex min-h-11 items-center text-terra-text underline sm:min-h-0">
              {link.label}
            </Link>
          ))}
        </p>
      </div>
    </section>
  );
}

/**
 * The command center (#1891): the landing for a workspace's saved institution. Five questions,
 * each answered from what Hamilton holds and linked to the page behind it. Deterministic: no model
 * call. A read that fails leaves its answer saying so, never the page down.
 */
export async function CommandCenter({ institution }: { institution: { id: number; name: string; stateCode: string | null } }) {
  const user = await getCurrentUser().catch(() => null);
  const [{ briefing }, financials, changes] = await Promise.all([
    loadBriefingOnce(user?.id ?? null, String(institution.id)),
    readFinancialPerformance(institution.id).then((r) => r.view).catch(() => null),
    getQuarterlyChangesOnce(institution.id).catch(() => null),
  ]);
  const answers = buildCommandCenter({
    institution,
    briefing,
    financials,
    changes,
    stateLabel: institution.stateCode ? (STATE_NAMES[institution.stateCode] ?? institution.stateCode) : null,
    windowDays: COMPETITOR_MOVE_WINDOW_DAYS,
  });
  const quarter = commandCenterQuarter(financials);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 text-warm-800">
      <MemoHeader
        kicker={quarter ? `Command center · latest filing ${quarter}` : "Command center"}
        title={institution.name}
        dek="Five questions about this institution, each answered from its filings and published fees, with the page behind each answer."
        actions={
          <Link
            href={hrefWithInstitutionContext("/pro/settings", String(institution.id))}
            className="inline-flex min-h-11 items-center text-sm text-terra-text underline sm:min-h-0"
          >
            Change institution
          </Link>
        }
      />
      <div>
        {answers.map((answer) => (
          <CommandCenterRow key={answer.key} answer={answer} />
        ))}
      </div>
    </div>
  );
}
