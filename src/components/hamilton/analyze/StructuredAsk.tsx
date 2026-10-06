"use client";

/**
 * The Ask bar's structured answer from the Hamilton engine (POST /api/hamilton/ask): the
 * four-role answer, a scenario, an opinion, a saved figure, or Hamilton's one clarifying
 * question answered in place. Deterministic and free; the written answer below it is the AI's.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import type { AskObjective, AskResponse, ClarifyingQuestion, Scenario } from "@/lib/hamilton/workspace/types";
import { EVIDENCE_LABELS } from "@/components/hamilton/memo/exhibit-view";
import { AnswerMemo } from "@/components/hamilton/memo/answer-memo";
import { SegmentTable } from "@/components/hamilton/memo/segment-table";
import { StorylineView } from "@/components/hamilton/storyline/StorylineView";
import { Callout, LinkButton, SERIF, fmtMoney, fmtSignedMoney } from "@/components/hamilton/memo/memo";

const OBJECTIVES: { key: AskObjective; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "customer_treatment", label: "Customer treatment" },
  { key: "competitive_position", label: "Competitive position" },
];

type AskBody = { institutionId: string | null; question?: string; decisionId?: string; answer?: { fieldKey: string; value: string | number } };

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

function QuestionForm({ question, onAnswer, busy }: { question: ClarifyingQuestion; onAnswer: (value: string) => void; busy: boolean }) {
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
      <p className="text-xs text-warm-600">Hamilton keeps your answer with your institution&apos;s figures. You can change it in Data.</p>
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
          <span className={label}>Per 1,000 items a year</span>
          <span className={value}>{fmtSignedMoney(s.per1000ItemsDelta)}</span>
        </div>
        <div className={cell}>
          <span className={label}>Fee income a year</span>
          <span className={value}>
            {s.revenueEffect
              ? s.revenueEffect.low === s.revenueEffect.high
                ? fmtSignedMoney(s.revenueEffect.low)
                : `${fmtSignedMoney(s.revenueEffect.low)} to ${fmtSignedMoney(s.revenueEffect.high)}`
              : "Needs your volume"}
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

export function StructuredAsk({
  question,
  institutionId,
  modelHrefFor,
  researchHrefFor,
}: {
  /** The question just asked; a new value asks again. */
  question: string | null;
  institutionId: string | null;
  modelHrefFor: (feeCategory: string, tested: number) => string;
  /** My fees for a fee, where the full market picture lives. */
  researchHrefFor?: (feeCategory: string) => string;
}) {
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const decisionId = useRef<string | undefined>(undefined);
  const lastQuestion = useRef<string | null>(null);

  const run = useCallback(
    async (body: Omit<AskBody, "institutionId" | "decisionId">) => {
      setBusy(true);
      setError(null);
      try {
        const res = await postAsk({ ...body, institutionId, decisionId: decisionId.current });
        if (res.decisionId) decisionId.current = res.decisionId;
        return res;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Hamilton could not answer that just now.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [institutionId],
  );

  useEffect(() => {
    if (!question || question === lastQuestion.current) return;
    lastQuestion.current = question;
    setResponse(null);
    void run({ question }).then((res) => res && setResponse(res));
  }, [question, run]);

  const answerQuestion = async (q: ClarifyingQuestion, value: string) => {
    const saved = await run({ answer: { fieldKey: q.fieldKey, value } });
    if (!saved) return;
    // An objective is remembered, then the original question is asked again with it.
    if (q.fieldKey === "decision.objective" && lastQuestion.current) {
      const again = await run({ question: lastQuestion.current });
      if (again) setResponse(again);
      return;
    }
    setResponse(saved);
  };

  if (!question) return null;
  if (busy && !response) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-warm-700">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading your figures and the market...
      </p>
    );
  }
  if (error && !response) return <p className="text-sm text-terra-text">{error}</p>;
  if (!response) return null;

  const q = response.question ?? response.answer?.question ?? null;
  // The market slice the question named ("$10B and up"), when the engine sends it.
  const segment = response.segment ?? null;
  // The storyline answer (engine 1.6.0), when the engine sends one.
  const storyline = response.answer?.storyline ?? null;
  const answerExhibit = response.answer?.exhibit ?? null;
  const exhibitOwn =
    answerExhibit && (answerExhibit.kind === "fee_position" || answerExhibit.kind === "competitor_range") ? answerExhibit : null;
  return (
    <div className="flex flex-col gap-5">
      {response.answer && storyline ? (
        <StorylineView
          story={storyline}
          nextSteps={
            researchHrefFor ? (
              <>
                <LinkButton href={researchHrefFor(response.answer.feeCategory)}>Every market layer</LinkButton>
                <LinkButton href={researchHrefFor(response.answer.feeCategory).replace("/pro/research", "/pro/simulate")} primary>
                  Try a price
                </LinkButton>
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
              </>
            ) : null
          }
        />
      ) : (
        <p className="text-xl leading-snug text-warm-900 sm:text-2xl" style={SERIF}>
          {response.shortAnswer}
        </p>
      )}
      {segment && !storyline ? <SegmentTable data={segment} own={exhibitOwn?.own ?? null} ownLabel={exhibitOwn?.ownLabel ?? "You"} /> : null}
      {response.kind === "opinion" && response.opinion ? (
        <Callout>
          <span className="font-medium text-warm-900">If the objective is {response.opinion.assumedObjective.replace(/_/g, " ")}: </span>
          {response.opinion.opinion}
        </Callout>
      ) : null}
      {response.scenario ? (
        <ScenarioSummary s={response.scenario} modelHref={modelHrefFor(response.scenario.feeCategory, response.scenario.tested)} />
      ) : null}
      {q && q.inputKind !== "file" ? <QuestionForm key={q.fieldKey} question={q} busy={busy} onAnswer={(v) => void answerQuestion(q, v)} /> : null}
      {error ? <p className="text-sm text-terra-text">{error}</p> : null}
    </div>
  );
}
