/**
 * Lab only, never linked or indexed: James compares five homepage Hamilton options on this
 * preview (Oct 17 05:05) before one goes into the homepage. Removed once he picks.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { getShowcaseAnalysisRow } from "@/lib/data-store/hamilton-analyses";
import { getCategoryChargeBases } from "@/lib/data-store/fee-index";
import { getWorkspaceBriefing } from "@/lib/hamilton/workspace/research";
import { mixedBasisCategories } from "@/lib/hamilton/report-evidence";
import type { Storyline } from "@/lib/hamilton/workspace/storyline-types";
import { showcaseAnswerId } from "../../landing-hamilton-answer";
import { ExhibitBoard, ExhibitStepper, FullAnswer, InstitutionPicker, LiveMonth, Section, type LiveBriefing, type SavedAnswer } from "./variants";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Hamilton options", robots: { index: false, follow: false, nocache: true } };

const OPTIONS = [
  { key: "a", name: "Exhibit board", note: "The saved answer as its headline, four figures and three of Hamilton's charts. No memo text." },
  { key: "b", name: "Exhibit tabs", note: "The same answer, one Hamilton chart at a time, all five behind short tabs." },
  { key: "c", name: "Full answer screen", note: "Hamilton's answer page exactly as Pro draws it, scrolling inside the window." },
  { key: "d", name: "This month, live", note: "Hamilton's monthly screen for Capital City Bank, computed from today's data." },
  { key: "e", name: "Pick an institution", note: "Option D with the demo institutions to switch between, each computed live." },
] as const;

const DEMO_CAST = [
  { id: 323, name: "Capital City Bank" },
  { id: 5, name: "U.S. Bank" },
  { id: 21, name: "M&T Bank" },
  { id: 4956, name: "Navy Federal" },
  { id: 6741, name: "SchoolsFirst" },
];

async function loadAnswer(): Promise<SavedAnswer | null> {
  const row = await getShowcaseAnalysisRow(showcaseAnswerId()).catch(() => null);
  const r = row?.response_json as { storyline?: Storyline; identityContext?: { researchInstitutionName?: string } } | null;
  const story = r?.storyline;
  if (!row || !story || !Array.isArray(story.exhibits) || !story.governingThought) return null;
  return {
    question: row.prompt ?? "",
    askedOn: row.created_at,
    institutionName: r?.identityContext?.researchInstitutionName ?? "Capital City Bank",
    story: { ...story, keyFigures: story.keyFigures ?? [], situation: story.situation ?? [], complication: story.complication ?? [] },
  };
}

async function loadLive(id: number): Promise<LiveBriefing | null> {
  try {
    const [briefing, bases] = await Promise.all([getWorkspaceBriefing(id), getCategoryChargeBases().catch(() => [])]);
    return briefing ? { briefing, mixedBasis: [...mixedBasisCategories(bases)] } : null;
  } catch {
    return null;
  }
}

export default async function HamiltonLab({ searchParams }: { searchParams: Promise<{ v?: string; bank?: string }> }) {
  const sp = await searchParams;
  const v = OPTIONS.find((o) => o.key === sp.v)?.key ?? "a";
  const bank = DEMO_CAST.find((d) => String(d.id) === sp.bank)?.id ?? 323;
  const option = OPTIONS.find((o) => o.key === v)!;

  let body: React.ReactNode = null;
  if (v === "a" || v === "b" || v === "c") {
    const answer = await loadAnswer();
    body = !answer ? null : v === "a" ? <ExhibitBoard answer={answer} /> : v === "b" ? <ExhibitStepper answer={answer} /> : <FullAnswer answer={answer} />;
  } else {
    const live = await loadLive(v === "d" ? 323 : bank);
    body = !live ? null : (
      <LiveMonth
        live={live}
        picker={v === "e" ? <InstitutionPicker options={DEMO_CAST} selected={bank} hrefFor={(id) => `/lab/hamilton?v=e&bank=${id}`} /> : undefined}
      />
    );
  }

  return (
    <main>
      <nav aria-label="Options" className="border-b border-border bg-surface-0">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
          <p className="text-[13px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Hamilton homepage options (preview only)</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {OPTIONS.map((o) => (
              <Link
                key={o.key}
                href={`/lab/hamilton?v=${o.key}`}
                aria-current={o.key === v ? "page" : undefined}
                className={`rounded-full border px-3.5 py-1.5 text-[14px] font-semibold ${o.key === v ? "border-ink bg-ink text-white" : "border-border text-ink-soft hover:border-ink"}`}
              >
                {o.key.toUpperCase()} · {o.name}
              </Link>
            ))}
          </div>
          <p className="mt-2 text-[14px] text-ink-soft">{option.note}</p>
        </div>
      </nav>
      <Section>{body ?? <p className="text-center text-ink-soft">This option&apos;s data didn&apos;t load.</p>}</Section>
    </main>
  );
}
