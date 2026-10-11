"use client";

/**
 * The Ask bar's structured answer from the Hamilton engine (POST /api/hamilton/ask): the
 * four-role answer, a scenario, an opinion, a saved figure, or Hamilton's one clarifying
 * question answered in place. Deterministic and free. When the answer carries a storyline,
 * Hamilton's written memo over it (POST /api/hamilton/ask/memo) follows; that call is paid.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import type { AskObjective, AskResponse, ClarifyingQuestion, Scenario } from "@/lib/hamilton/workspace/types";
import { EVIDENCE_LABELS } from "@/components/hamilton/memo/exhibit-view";
import { AnswerMemo } from "@/components/hamilton/memo/answer-memo";
import { SegmentTable } from "@/components/hamilton/memo/segment-table";
import { StorylineView, type MemoState } from "@/components/hamilton/storyline/StorylineView";
import type { StorylineMemoResult } from "@/lib/hamilton/workspace/storyline-types";
import { Callout, LinkButton, SERIF, fmtMoney, fmtSignedMoney } from "@/components/hamilton/memo/memo";
import { getDisplayName, getSpotlightCategories } from "@/lib/fee-taxonomy";
import { FactList, SchedulePositionsChart } from "./schedule-answer";
import { LocalMarketView } from "./local-market";
import { isLocalMarketQuestion } from "@/lib/hamilton/local-market-question";
import { matchFeeCategory } from "@/lib/hamilton/workspace/ask";
import type { LocalMarketAnswer } from "@/lib/hamilton/local-market-answer";
import { hamiltonIdentityLines, readHamiltonIdentitySnapshot } from "@/lib/hamilton/identity-display";

/** The engine answered on its own (an answer, every fee's position, or sourced findings), so no written answer is needed. */
export function engineAnswered(res: AskResponse): boolean {
  return Boolean(res.answer || (res.positions && res.positions.length > 0) || (res.facts && res.facts.length > 0));
}

const OBJECTIVES: { key: AskObjective; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "customer_treatment", label: "Customer treatment" },
  { key: "competitive_position", label: "Competitive position" },
];

type AskBody = {
  institutionId: string | null;
  question?: string;
  decisionId?: string;
  /** The saved analysis the Ask filed; the memo is added to that row. */
  savedAnalysisId?: string;
  answer?: { fieldKey: string; value: string | number };
};

/** The local market for a competitors-and-locations question; null when none is on file. */
async function postMarket(institutionId: string | null): Promise<LocalMarketAnswer | null> {
  try {
    const res = await fetch("/api/hamilton/ask/market", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ institutionId: institutionId ?? undefined }),
    });
    if (!res.ok) return null;
    return (await res.json()) as LocalMarketAnswer;
  } catch {
    return null;
  }
}

async function postAsk(body: AskBody): Promise<AskResponse> {
  const res = await fetch("/api/hamilton/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, institutionId: body.institutionId ?? undefined }),
  });
  const json = (await res.json().catch(() => ({}))) as AskResponse & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "Hamilton could not answer that just now.");
  return json;
}

/** Hamilton's memo over the storyline the Ask bar just returned; the same body as the Ask. */
async function postMemo(body: AskBody): Promise<MemoState> {
  try {
    const res = await fetch("/api/hamilton/ask/memo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, institutionId: body.institutionId ?? undefined }),
    });
    const json = (await res.json().catch(() => ({}))) as Partial<StorylineMemoResult> & { error?: string };
    if (json.status === "written" && "memo" in json && json.memo) return { state: "written", memo: json.memo };
    if ((json.status === "withheld" || json.status === "unavailable") && "reason" in json && json.reason) {
      return { state: "none", reason: json.reason };
    }
    return { state: "none", reason: json.error ?? "Hamilton could not write this up just now; the exhibits stand on their own." };
  } catch {
    return { state: "none", reason: "Hamilton could not write this up just now; the exhibits stand on their own." };
  }
}

/**
 * The saved answer as a PDF. The Ask files the answer when it returns, so the download is
 * offered at once and never waits on the memo, which may be withheld.
 */
export function DownloadAnswerPdf({ analysisId, memoWriting = false }: { analysisId: string; memoWriting?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const download = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/pro/report-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "analysis", analysisId }),
      });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `hamilton-answer-${new Date().toISOString().split("T")[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        onClick={download}
        disabled={busy}
        className="rounded-md border border-warm-300 bg-warm-50 px-3.5 py-2 text-sm text-warm-800 hover:border-warm-500 disabled:opacity-50"
      >
        {busy ? "Preparing the PDF…" : memoWriting ? "Download PDF (exhibits only)" : "Download PDF"}
      </button>
      {failed ? (
        <span role="alert" className="text-sm text-terra-text">
          The PDF couldn&apos;t be created. Please try again.
        </span>
      ) : null}
    </>
  );
}

/** The fees offered as one-tap answers when Hamilton asks which fee. */
const FEE_CHOICES = getSpotlightCategories().map((c) => ({ key: c, label: getDisplayName(c).replace(/\s*\([^)]*\)/g, "") }));

/**
 * When a question names no fee, Hamilton answers it in writing straight away; this quiet row
 * only offers charts for one fee on top of that answer. It never stands in the reader's way.
 */
function FeeCharts({ busy, notFound, onPick }: { busy: boolean; notFound: string | null; onPick: (label: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-warm-700">See the charts for one fee:</p>
      <div className="flex flex-wrap gap-2">
        {FEE_CHOICES.map((f) => (
          <button
            key={f.key}
            type="button"
            disabled={busy}
            onClick={() => onPick(f.label)}
            className="rounded-md border border-warm-300 bg-white px-3 py-1.5 text-sm text-warm-900 hover:border-terra hover:text-terra-text disabled:opacity-50"
          >
            {f.label}
          </button>
        ))}
      </div>
      {busy ? (
        <p role="status" className="flex items-center gap-2 text-sm text-warm-700">
          <Loader2 className="h-4 w-4 animate-spin" /> Working on it...
        </p>
      ) : null}
      {notFound ? (
        <p role="status" className="text-sm text-terra-text">
          Hamilton has no charts for &ldquo;{notFound}&rdquo; yet.
        </p>
      ) : null}
    </div>
  );
}

function QuestionForm({
  question,
  onAnswer,
  busy,
  notFound,
}: {
  question: ClarifyingQuestion;
  onAnswer: (value: string) => void;
  busy: boolean;
  /** The last answer Hamilton could not use, so the reader sees why it asked again. */
  notFound?: string | null;
}) {
  const [value, setValue] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim()) onAnswer(value.trim());
  };
  const objective = question.fieldKey === "decision.objective";
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-terra/40 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-[0.1em] text-terra-text">Hamilton has one question</p>
      <p className="text-lg leading-snug text-warm-900" style={SERIF}>
        {question.prompt}
      </p>
      {notFound ? (
        <p role="status" className="text-sm text-terra-text">
          Hamilton couldn&apos;t read &ldquo;{notFound}&rdquo;. Please try again.
        </p>
      ) : null}
      {busy ? (
        <p role="status" className="flex items-center gap-2 text-sm text-warm-700">
          <Loader2 className="h-4 w-4 animate-spin" /> Working on it...
        </p>
      ) : null}
      {objective ? (
        <div className="flex flex-wrap gap-2">
          {OBJECTIVES.map((o) => (
            <button
              key={o.key}
              type="button"
              disabled={busy}
              onClick={() => onAnswer(o.key)}
              className="rounded-md border border-warm-300 bg-white px-3.5 py-2 text-sm text-warm-900 hover:border-terra hover:text-terra-text disabled:opacity-50"
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
          <div className="relative w-56">
            <input
              aria-label={question.prompt}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              inputMode={question.inputKind === "number" ? "numeric" : question.inputKind === "percent" ? "decimal" : "text"}
              autoComplete="off"
              className={`w-full rounded-md border border-warm-300 bg-white px-3 py-2 text-sm text-warm-900 focus:border-terra focus:outline-none focus:ring-1 focus:ring-terra ${question.inputKind === "percent" ? "pr-8" : ""}`}
            />
            {question.inputKind === "percent" ? <span className="pointer-events-none absolute right-3 top-2 text-sm text-warm-600">%</span> : null}
          </div>
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark disabled:opacity-50"
          >
            {busy ? "Saving..." : "Answer"}
          </button>
        </form>
      )}
      <p className="text-xs text-warm-600">Hamilton keeps this answer in your private workspace under the researched institution.</p>
    </div>
  );
}

function ScenarioSummary({ s, modelHref }: { s: Scenario; modelHref: string | null }) {
  const cell = "flex flex-col gap-0.5";
  const label = "text-xs uppercase tracking-[0.08em] text-warm-600";
  const value = "text-lg text-warm-900 [font-variant-numeric:tabular-nums]";
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-warm-300 bg-warm-50 p-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className={cell}>
          <span className={label}>Price tested</span>
          <span className={value}>
            {fmtMoney(s.current)} to {fmtMoney(s.tested)}
          </span>
        </div>
        <div className={cell}>
          <span className={label}>{s.peerLabel} charging less</span>
          <span className={value}>
            {s.peersLess} of {s.n}
          </span>
        </div>
        <div className={cell}>
          <span className={label}>Change per 1,000 items charged</span>
          <span className={value}>{fmtSignedMoney(s.per1000ItemsDelta)}</span>
        </div>
        <div className={cell}>
          <span className={label}>Fee income a year</span>
          <span className={value}>
            {s.revenueEffect
              ? s.revenueEffect.low === s.revenueEffect.high
                ? fmtSignedMoney(s.revenueEffect.low)
                : `${fmtSignedMoney(s.revenueEffect.low)} to ${fmtSignedMoney(s.revenueEffect.high)}`
              : "Needs institution volume"}
          </span>
        </div>
      </div>
      {s.assumptions.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-warm-700">
          {s.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-warm-600">
          Evidence: <span className="font-medium text-warm-800">{EVIDENCE_LABELS[s.evidenceLevel]}</span>
        </p>
        {modelHref ? <LinkButton href={modelHref}>Compare more prices</LinkButton> : null}
      </div>
    </div>
  );
}

/** A subject or retry owns its own state; late work cannot enter another answer. */
export function StructuredAsk(props: Parameters<typeof StructuredAskConversation>[0]) {
  return <StructuredAskConversation key={JSON.stringify([props.institutionId, props.question, props.nonce ?? 0])} {...props} />;
}

function StructuredAskConversation({
  question,
  nonce = 0,
  institutionId,
  modelHrefFor,
  researchHrefFor,
  onNoStoryline,
  onStoryline,
  onBusyChange,
  onLead,
}: {
  /** The question just asked; a new value asks again. */
  question: string | null;
  /** Bumped on every ask, so the same question asked again (or Try again) runs again. */
  nonce?: number;
  institutionId: string | null;
  modelHrefFor: (feeCategory: string, tested: number) => string;
  /** My fees for a fee, where the full market picture lives. */
  researchHrefFor?: (feeCategory: string) => string;
  /** Called once per question when the engine has no storyline for it, so the page can answer in prose instead. */
  onNoStoryline?: (question: string) => void;
  /** Called when a storyline answer replaces whatever the page showed (a fee picked after a written answer). */
  onStoryline?: () => void;
  /** Reports when the engine is working, so the page shows one progress strip for the whole ask. */
  onBusyChange?: (busy: boolean) => void;
  /** The answer's one-line lead once known, for the conversation above the next question. */
  onLead?: (lead: string) => void;
}) {
  const [response, setResponse] = useState<AskResponse | null>(null);
  // A competitors-and-locations question is answered with the market itself (no fee to chart).
  const [market, setMarket] = useState<LocalMarketAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const decisionId = useRef<string | undefined>(undefined);
  const lastQuestion = useRef<string | null>(null);
  const lastNonce = useRef<number | null>(null);
  const [memo, setMemo] = useState<MemoState | undefined>(undefined);
  // An answer Hamilton could not use: it asks again, and the card says why.
  const [notFound, setNotFound] = useState<string | null>(null);
  // The question the memo was asked for; a newer question drops an older memo's result.
  const memoFor = useRef<string | null>(null);
  const active = useRef(true);
  const requestGeneration = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      requestGeneration.current += 1;
      memoFor.current = null;
    };
  }, []);

  const run = useCallback(
    async (body: Omit<AskBody, "institutionId" | "decisionId">) => {
      const generation = ++requestGeneration.current;
      setBusy(true);
      setError(null);
      try {
        const res = await postAsk({ ...body, institutionId, decisionId: decisionId.current });
        if (!active.current || generation !== requestGeneration.current) return null;
        if (res.decisionId) decisionId.current = res.decisionId;
        return res;
      } catch (e) {
        if (!active.current || generation !== requestGeneration.current) return null;
        setError(e instanceof Error ? e.message : "Hamilton could not answer that just now.");
        return null;
      } finally {
        if (active.current && generation === requestGeneration.current) setBusy(false);
      }
    },
    [institutionId],
  );

  // A storyline answer gets Hamilton's memo; anything else (bar a clarifying question) is
  // handed back to the page to answer in prose.
  const follow = useCallback(
    (asked: string, res: AskResponse | null) => {
      if (!active.current) return;
      if (res?.answer?.storyline) {
        onStoryline?.();
        onLead?.(res.answer.storyline.governingThought);
        memoFor.current = asked;
        setMemo({ state: "writing" });
        void postMemo({ institutionId, question: asked, decisionId: decisionId.current, savedAnalysisId: res.savedAnalysisId }).then((m) => {
          if (active.current && memoFor.current === asked) setMemo(m);
        });
        return;
      }
      // "Which fee?" is never a wall: a question that names no fee (often a follow-up such as
      // "how does this compare nationally?") gets a written answer at once.
      if (res?.question && res.question.fieldKey !== "ask.fee_category") return;
      // The engine's own answer stands; a second, model-written answer would bury it.
      if (res && !res.question && engineAnswered(res)) {
        if (res.shortAnswer.trim()) onLead?.(res.shortAnswer.trim());
        return;
      }
      // The written answer takes over, so a failed engine call is not shown above it as an error.
      setError(null);
      onNoStoryline?.(asked);
    },
    [institutionId, onNoStoryline, onStoryline, onLead],
  );

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    if (!question || (question === lastQuestion.current && nonce === lastNonce.current)) return;
    lastQuestion.current = question;
    lastNonce.current = nonce;
    memoFor.current = null;
    setMemo(undefined);
    setResponse(null);
    setMarket(null);
    setNotFound(null);
    const asked = question;
    void (async () => {
      if (isLocalMarketQuestion(asked) && !matchFeeCategory(asked)) {
        setBusy(true);
        const found = await postMarket(institutionId);
        if (!active.current) return;
        setBusy(false);
        if (lastQuestion.current !== asked) return;
        if (found) {
          setMarket(found);
          onLead?.(`The banks and credit unions in ${found.market.label}, by deposits and branches.`);
          return;
        }
      }
      const res = await run({ question: asked });
      if (!active.current || lastQuestion.current !== asked) return;
      if (res) setResponse(res);
      follow(asked, res);
    })();
  }, [question, nonce, run, follow, institutionId, onLead]);

  const answerQuestion = async (q: ClarifyingQuestion, value: string) => {
    setNotFound(null);
    const saved = await run({ answer: { fieldKey: q.fieldKey, value } });
    if (!active.current || !saved) return;
    const again = saved.question ?? saved.answer?.question ?? null;
    if (again && again.fieldKey === q.fieldKey) setNotFound(value);
    // A fee answer that found a storyline gets Hamilton's memo like any other answer.
    if (q.fieldKey === "ask.fee_category" && saved.answer?.storyline && lastQuestion.current) {
      setResponse(saved);
      follow(lastQuestion.current, saved);
      return;
    }
    // An objective is remembered, then the original question is asked again with it.
    if (q.fieldKey === "decision.objective" && lastQuestion.current) {
      const asked = lastQuestion.current;
      const again = await run({ question: asked });
      if (!active.current) return;
      if (again) setResponse(again);
      follow(asked, again);
      return;
    }
    setResponse(saved);
  };

  if (!question) return null;
  if (market) return <LocalMarketView data={market} />;
  // The page shows one progress strip for the whole ask when it listens for busy.
  if (busy && !response && onBusyChange) return null;
  if (busy && !response) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-warm-700">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading the selected institution and market...
      </p>
    );
  }
  if (error && !response) return <p className="text-sm text-terra-text">{error}</p>;
  if (!response) return null;

  const q = response.question ?? response.answer?.question ?? null;
  // The market slice the question named ("$10B and up"), when the engine sends it.
  const segment = response.segment ?? null;
  // The storyline answer (engine 1.6.0), when the engine sends one.
  // When every fee is drawn above, the storyline's own overview matrix would repeat it as a table.
  const rawStoryline = response.answer?.storyline ?? null;
  const storyline =
    rawStoryline && response.positions?.length
      ? { ...rawStoryline, exhibits: rawStoryline.exhibits.filter((e) => e.id !== "schedule-overview").map((e, i) => ({ ...e, number: i + 1 })) }
      : rawStoryline;
  const answerExhibit = response.answer?.exhibit ?? null;
  const exhibitOwn =
    answerExhibit && (answerExhibit.kind === "fee_position" || answerExhibit.kind === "competitor_range") ? answerExhibit : null;
  return (
    <div className="flex flex-col gap-5">
      {hamiltonIdentityLines(readHamiltonIdentitySnapshot(response.identityContext)).map(line => <p key={line} className="text-sm text-warm-700">{line}</p>)}
      {response.positions && response.positions.length > 0 ? (
        <>
          {/* The takeaways lead; the table and the top fee's storyline follow. Without a storyline
              or answer the same sentence already shows below, so it is not repeated. */}
          {response.answer && response.shortAnswer.trim() ? (
            <p className="max-w-[68ch] text-xl leading-snug text-warm-900 sm:text-2xl [font-variant-numeric:tabular-nums]" style={SERIF}>
              {response.shortAnswer}
            </p>
          ) : null}
          <SchedulePositionsChart rows={response.positions} hrefFor={researchHrefFor} />
        </>
      ) : null}
      {response.answer && storyline ? (
        <StorylineView
          story={storyline}
          identityContext={response.identityContext}
          memo={memo}
          nextSteps={
            researchHrefFor ? (
              <>
                <LinkButton href={researchHrefFor(response.answer.feeCategory)}>Every market layer</LinkButton>
                <LinkButton href={researchHrefFor(response.answer.feeCategory).replace("/pro/research", "/pro/simulate")} primary>
                  Try a price
                </LinkButton>
                {response.savedAnalysisId ? <DownloadAnswerPdf analysisId={response.savedAnalysisId} memoWriting={memo?.state === "writing"} /> : null}
              </>
            ) : null
          }
        />
      ) : response.answer ? (
        <AnswerMemo
          answer={{ ...response.answer, question: null }}
          nextSteps={
            researchHrefFor ? (
              <>
                <LinkButton href={researchHrefFor(response.answer.feeCategory)}>Every market layer</LinkButton>
                <LinkButton href={researchHrefFor(response.answer.feeCategory).replace("/pro/research", "/pro/simulate")} primary>
                  Try a price
                </LinkButton>
                {response.savedAnalysisId ? <DownloadAnswerPdf analysisId={response.savedAnalysisId} memoWriting={memo?.state === "writing"} /> : null}
              </>
            ) : null
          }
        />
      ) : q && response.shortAnswer.trim() === q.prompt.trim() ? null : (
        <p className="text-xl leading-snug text-warm-900 sm:text-2xl" style={SERIF}>
          {response.shortAnswer}
        </p>
      )}
      {!response.answer && !response.positions?.length && response.facts && response.facts.length > 0 ? <FactList facts={response.facts} /> : null}
      {segment && !storyline ? <SegmentTable data={segment} own={exhibitOwn?.own ?? null} ownLabel={exhibitOwn?.ownLabel ?? "Research subject"} /> : null}
      {response.kind === "opinion" && response.opinion ? (
        <Callout>
          <span className="font-medium text-warm-900">If the objective is {response.opinion.assumedObjective.replace(/_/g, " ")}: </span>
          {response.opinion.opinion}
        </Callout>
      ) : null}
      {response.scenario ? (
        <ScenarioSummary s={response.scenario} modelHref={modelHrefFor(response.scenario.feeCategory, response.scenario.tested)} />
      ) : null}
      {q && q.fieldKey === "ask.fee_category" ? (
        <FeeCharts busy={busy} notFound={notFound} onPick={(label) => void answerQuestion(q, label)} />
      ) : null}
      {q && q.fieldKey !== "ask.fee_category" && q.inputKind !== "file" ? (
        <QuestionForm
          key={q.fieldKey}
          question={q}
          busy={busy}
          notFound={notFound}
          onAnswer={(v) => void answerQuestion(q, v)}
        />
      ) : null}
      {error ? <p className="text-sm text-terra-text">{error}</p> : null}
    </div>
  );
}
