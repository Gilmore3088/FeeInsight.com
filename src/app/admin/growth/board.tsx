import Link from "next/link";
import { formatAdminDateTime } from "@/lib/admin-time";
import type { AutomationControlState } from "@/lib/automation-control";
import type { ContentDraft, ContentDraftStatus } from "@/lib/data-store/content-drafts";
import type { GrowthBudgetState, GrowthStep } from "@/lib/data-store/growth-board";
import type { GrowthLesson } from "@/lib/agents/growth/lessons";
import { GROWTH_AGENT_ROLES, GROWTH_AGENTS, QUEUE_KINDS, type GrowthAgent } from "@/lib/agents/growth/roster";
import { CardActions } from "./card-actions";
import {
  filterHref,
  filterQueue,
  label,
  sectionFor,
  viewHref,
  type GrowthPageState,
  type GrowthView,
  type QueueFilter,
} from "./queue-view";

/** How many queue items the page reads (`page.tsx`), and how many steps each agent shows. */
export const QUEUE_LIMIT = 200;
const STEPS_PER_AGENT = 5;

/** A `<summary>` drawn as a small outlined button, with the browser's disclosure marker hidden. */
const SUMMARY_BUTTON =
  "inline-flex cursor-pointer list-none select-none items-center rounded-md border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 dark:border-gray-600 dark:text-gray-300 [&::-webkit-details-marker]:hidden";
const CARD = "rounded-lg border border-black/[0.08] bg-white p-4 dark:border-white/[0.1] dark:bg-white/[0.03]";
const MUTED = "text-sm text-gray-500";

function QueueItem({ item }: { item: ContentDraft }) {
  const hasCard = item.kind === "linkedin_post" && item.facts.source !== "intake";
  const links = item.prUrl || hasCard;
  return (
    <li className={CARD}>
      <p className="text-xs uppercase tracking-wide text-gray-500">
        {item.agent} · {label(item.kind)}
      </p>
      <h3 className="mt-1 break-words text-base font-semibold text-gray-900 dark:text-gray-100">{item.title}</h3>
      <p className="mt-1 line-clamp-2 break-words text-sm text-gray-600 dark:text-gray-400">{item.caption}</p>

      {item.status === "skipped" ? (
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          {item.skipReason ? `Skipped: ${item.skipReason}` : "Skipped with no reason given."}
        </p>
      ) : null}
      {item.status === "posted" ? (
        <p className="mt-2 text-xs text-gray-500">
          Done {formatAdminDateTime(item.postedAt ?? item.reviewedAt)}
          {item.score !== null ? ` · Score: ${item.score} tracked visits in the week after` : item.scoredAt ? " · Checked, no measure for this kind" : " · Not scored yet"}
        </p>
      ) : null}

      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-gray-500">More</summary>
        <div className="mt-2 space-y-2">
          <p className="text-xs text-gray-500">
            {item.channel} · filed {formatAdminDateTime(item.createdAt)}
          </p>
          {links ? (
            <p className="flex flex-wrap gap-x-4 gap-y-1">
              {item.prUrl ? (
                <a href={item.prUrl} target="_blank" rel="noreferrer" className="text-gray-700 underline dark:text-gray-300">
                  Pull request
                </a>
              ) : null}
              {hasCard ? (
                <a href={`/api/admin/content/card/${item.id}`} target="_blank" rel="noreferrer" className="text-gray-700 underline dark:text-gray-300">
                  Card image
                </a>
              ) : null}
            </p>
          ) : null}
          <p className="whitespace-pre-line break-words text-gray-700 dark:text-gray-300">{item.caption}</p>
        </div>
      </details>

      <CardActions id={item.id} status={item.status} title={item.title} caption={item.caption} />
    </li>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-full px-3 py-1 text-sm ${
        active
          ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
          : "border border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300"
      }`}
    >
      {children}
    </Link>
  );
}

/** The agent and kind chips, folded behind one "Filter" disclosure; a set filter shows as one chip that clears it. */
function Filters({ filter, view }: { filter: QueueFilter; view: GrowthView }) {
  const active = [filter.agent, filter.kind ? label(filter.kind) : null].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-wrap items-start gap-2">
      <details className="open:basis-full">
        <summary className={SUMMARY_BUTTON}>Filter</summary>
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-12 text-xs uppercase tracking-wide text-gray-500">Agent</span>
            <Chip href={filterHref(filter, { agent: null }, view)} active={!filter.agent}>
              All
            </Chip>
            {GROWTH_AGENTS.map((agent) => (
              <Chip key={agent} href={filterHref(filter, { agent }, view)} active={filter.agent === agent}>
                {agent}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-12 text-xs uppercase tracking-wide text-gray-500">Kind</span>
            <Chip href={filterHref(filter, { kind: null }, view)} active={!filter.kind}>
              All
            </Chip>
            {QUEUE_KINDS.map((kind) => (
              <Chip key={kind} href={filterHref(filter, { kind }, view)} active={filter.kind === kind}>
                {label(kind)}
              </Chip>
            ))}
          </div>
        </div>
      </details>
      {active ? (
        <Link
          href={filterHref(filter, { agent: null, kind: null }, view)}
          aria-label={`Clear filter: ${active}`}
          className="rounded-full bg-gray-900 px-3 py-1 text-sm text-white dark:bg-gray-100 dark:text-gray-900"
        >
          {active} ×
        </Link>
      ) : null}
    </div>
  );
}

function marketingShort(control: AutomationControlState | null): string {
  if (!control) return "Marketing unread";
  return control.enabled ? "Marketing running" : "Marketing paused";
}

function budgetShort(budget: GrowthBudgetState | null): string {
  if (!budget) return "Growth budget unread";
  if (budget.state === "missing") return "No growth budget";
  return budget.state === "enabled" ? "Growth budget on" : "Growth budget off";
}

function marketingLine(control: AutomationControlState | null): string {
  if (!control) return "Couldn't read the marketing control.";
  if (control.enabled) return "Running. Growth's scheduled steps run when they are due.";
  const why = control.reason ? `: ${control.reason}` : "";
  return `Paused by ${control.changedBy} on ${formatAdminDateTime(control.changedAt)}${why}. Growth's runs wait queued until it is turned back on.`;
}

function budgetLine(budget: GrowthBudgetState | null): string {
  if (!budget) return "Couldn't read the agent:growth budget.";
  if (budget.state === "missing") return "No agent:growth budget row, so growth makes no paid model calls.";
  const caps = [
    budget.dailyCapUsd !== null ? `$${budget.dailyCapUsd.toFixed(2)} a day` : null,
    budget.monthlyCapUsd !== null ? `$${budget.monthlyCapUsd.toFixed(2)} a month` : null,
  ].filter(Boolean);
  const capText = caps.length ? ` Caps: ${caps.join(", ")}.` : "";
  return budget.state === "enabled"
    ? `Enabled. Paid drafting can run inside its caps.${capText}`
    : `Off. Paid drafting (marketing-write) makes no model call until you enable it.${capText}`;
}

/** The marketing pause and the budget as one short line; tapping it shows the full wording. */
function StatusLine({ control, budget }: { control: AutomationControlState | null; budget: GrowthBudgetState | null }) {
  const paused = control !== null && !control.enabled;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-gray-600 dark:text-gray-400">
        <span className={paused ? "font-medium text-amber-700 dark:text-amber-400" : undefined}>{marketingShort(control)}</span> ·{" "}
        {budgetShort(budget)}
      </summary>
      <dl className="mt-2 space-y-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">Marketing</dt>
          <dd className="text-gray-900 dark:text-gray-100">{marketingLine(control)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">Budget (agent:growth)</dt>
          <dd className="text-gray-900 dark:text-gray-100">{budgetLine(budget)}</dd>
        </div>
      </dl>
    </details>
  );
}

function Tabs({ state, counts }: { state: GrowthPageState; counts: { review: number | null; approved: number | null } }) {
  const tabs: { view: GrowthView; text: string }[] = [
    { view: "review", text: counts.review === null ? "To review" : `To review (${counts.review})` },
    { view: "approved", text: counts.approved === null ? "Approved" : `Approved (${counts.approved})` },
    { view: "done", text: "Done" },
    { view: "skipped", text: "Skipped" },
    { view: "team", text: "Team" },
  ];
  return (
    <nav aria-label="Growth views" className="overflow-x-auto">
      <ul className="flex min-w-max justify-between gap-0.5 rounded-lg bg-gray-100 p-1 sm:inline-flex sm:justify-start sm:gap-1 dark:bg-white/[0.06]">
        {tabs.map((tab) => {
          const active = tab.view === state.view;
          return (
            <li key={tab.view}>
              <Link
                href={viewHref(state, tab.view)}
                aria-current={active ? "page" : undefined}
                className={`block whitespace-nowrap rounded-md px-1.5 py-1.5 text-[13px] sm:px-3 sm:text-sm ${
                  active
                    ? "bg-white font-medium text-gray-900 shadow-sm dark:bg-gray-800 dark:text-gray-100"
                    : "text-gray-600 dark:text-gray-400"
                }`}
              >
                {tab.text}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function StepRow({ step }: { step: GrowthStep }) {
  const failed = step.status === "failed" || step.status === "blocked";
  return (
    <li className="space-y-0.5 border-t border-black/[0.06] pt-2 first:border-t-0 first:pt-0 dark:border-white/[0.08]">
      <p className="text-xs text-gray-500">
        Run #{step.runId} · {step.stepKey} · <span className={failed ? "font-medium text-red-700 dark:text-red-400" : undefined}>{step.status}</span> ·{" "}
        {formatAdminDateTime(step.at)}
      </p>
      <p className="break-words text-sm text-gray-900 dark:text-gray-100">{step.title}</p>
      {step.errorSummary ? (
        <p className="break-words text-sm text-red-700 dark:text-red-400">{step.errorSummary}</p>
      ) : step.summary ? (
        <p className="break-words text-sm text-gray-600 dark:text-gray-400">{step.summary}</p>
      ) : null}
    </li>
  );
}

function AgentSection({
  agent,
  steps,
  lessons,
}: {
  agent: GrowthAgent | null;
  steps: GrowthStep[] | null;
  lessons: GrowthLesson[] | null | undefined;
}) {
  return (
    <section className={`${CARD} space-y-3`} id={agent ? `agent-${agent}` : "agent-team"}>
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{agent ? agent.toUpperCase() : "Team work"}</h3>
        <p className={MUTED}>{agent ? GROWTH_AGENT_ROLES[agent] : "Growth's steps no single agent owns yet: the monthly email and the weekly scoring."}</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-500">Recent steps</p>
        {steps === null ? (
          <p className={`mt-1 ${MUTED}`}>Couldn&apos;t read the run ledger.</p>
        ) : steps.length ? (
          <ul className="mt-2 space-y-2">
            {steps.slice(0, STEPS_PER_AGENT).map((step) => (
              <StepRow key={step.stepId} step={step} />
            ))}
          </ul>
        ) : (
          <p className={`mt-1 ${MUTED}`}>No runs on the ledger yet.</p>
        )}
      </div>
      {agent ? (
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">Lessons from your skips</p>
          {lessons === null || lessons === undefined ? (
            <p className={`mt-1 ${MUTED}`}>Couldn&apos;t read the lessons.</p>
          ) : lessons.length ? (
            <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
              {lessons.map((lesson) => (
                <li key={`${lesson.draftId}-${lesson.at}`} className="break-words">
                  &ldquo;{lesson.title}&rdquo; skipped: {lesson.reason}
                </li>
              ))}
            </ul>
          ) : (
            <p className={`mt-1 ${MUTED}`}>No lessons yet.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Per-agent runs and lessons. An agent with no runs and no lessons (both read, both empty)
 * folds into one line; one whose reads failed keeps its card so the failure shows.
 */
function TeamView({ steps, lessons }: { steps: GrowthStep[] | null; lessons: Map<GrowthAgent, GrowthLesson[] | null> }) {
  const stepsFor = (agent: GrowthAgent | null) => (steps ? steps.filter((step) => step.agent === agent) : null);
  const quiet: string[] = [];
  const active: GrowthAgent[] = [];
  for (const agent of GROWTH_AGENTS) {
    const own = stepsFor(agent);
    const learned = lessons.get(agent);
    if (own !== null && own.length === 0 && Array.isArray(learned) && learned.length === 0) quiet.push(agent);
    else active.push(agent);
  }
  const teamSteps = stepsFor(null);
  const teamQuiet = teamSteps !== null && teamSteps.length === 0;
  if (teamQuiet) quiet.push("team work");

  return (
    <section className="space-y-4">
      <p className={MUTED}>Each agent&apos;s newest steps on the run ledger (agent growth) and the standing lessons from your skip reasons.</p>
      {active.length || !teamQuiet ? (
        <div className="grid gap-4 md:grid-cols-2">
          {active.map((agent) => (
            <AgentSection key={agent} agent={agent} steps={stepsFor(agent)} lessons={lessons.get(agent)} />
          ))}
          {teamQuiet ? null : <AgentSection agent={null} steps={teamSteps} lessons={null} />}
        </div>
      ) : null}
      {quiet.length ? <p className={MUTED}>No activity yet: {quiet.join(", ")}.</p> : null}
    </section>
  );
}

/** What the page read. `null` means the read failed, shown as unread rather than empty. */
export interface GrowthBoardData {
  view: GrowthView;
  filter: QueueFilter;
  /** Whether content_drafts exists (`null`: couldn't tell). */
  ready: boolean | null;
  items: ContentDraft[] | null;
  control: AutomationControlState | null;
  budget: GrowthBudgetState | null;
  /** Read only for the team view; other views pass `null`, which they never draw. */
  steps: GrowthStep[] | null;
  lessons: Map<GrowthAgent, GrowthLesson[] | null>;
}

/** The approval page's body, drawn from what `page.tsx` read. Only the chosen view renders. */
export function GrowthBoard({ view, filter, ready, items, control, budget, steps, lessons }: GrowthBoardData) {
  const state: GrowthPageState = { view, filter };
  const shown = items ? filterQueue(items, filter) : null;
  const count = (status: ContentDraftStatus) => (shown ? shown.filter((item) => item.status === status).length : null);
  const filtered = Boolean(filter.agent || filter.kind);
  const section = sectionFor(view);
  const list = section && shown ? shown.filter((item) => item.status === section.status) : [];

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-gray-500">
          <Link href="/admin/customers" className="underline">
            Customers
          </Link>{" "}
          · Growth
        </p>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Growth approvals</h1>
        <StatusLine control={control} budget={budget} />
      </header>

      <Tabs state={state} counts={{ review: count("draft"), approved: count("approved") }} />

      {section ? (
        <section className="space-y-3">
          <Filters filter={filter} view={view} />
          {ready === false ? (
            <p className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
              The content_drafts table doesn&apos;t exist yet, so there is nothing to show.
            </p>
          ) : items === null ? (
            <p className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">Couldn&apos;t read the queue.</p>
          ) : list.length ? (
            <>
              <p className="text-xs text-gray-500">{section.note}</p>
              <ul className="space-y-3">
                {list.map((item) => (
                  <QueueItem key={item.id} item={item} />
                ))}
              </ul>
            </>
          ) : (
            <p className="py-6 text-center text-sm text-gray-500">{filtered ? `${section.empty.replace(/\.$/, "")} for this filter.` : section.empty}</p>
          )}
          {items && items.length >= QUEUE_LIMIT ? <p className="text-xs text-gray-500">Showing the newest {QUEUE_LIMIT} items.</p> : null}
        </section>
      ) : (
        <TeamView steps={steps} lessons={lessons} />
      )}
    </div>
  );
}
