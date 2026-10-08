import Link from "next/link";
import { formatAdminDateTime } from "@/lib/admin-time";
import type { AutomationControlState } from "@/lib/automation-control";
import type { ContentDraft, ContentDraftStatus } from "@/lib/data-store/content-drafts";
import type { GrowthBudgetState, GrowthStep } from "@/lib/data-store/growth-board";
import type { GrowthLesson } from "@/lib/agents/growth/lessons";
import { GROWTH_AGENT_ROLES, GROWTH_AGENTS, QUEUE_KINDS, type GrowthAgent } from "@/lib/agents/growth/roster";
import { saveDraftTextAction, setDraftStatusAction } from "../customers/content/actions";
import { QUEUE_SECTIONS, filterHref, filterQueue, label, type QueueFilter } from "./queue-view";

/** How many queue items the page reads (`page.tsx`), and how many steps each agent shows. */
export const QUEUE_LIMIT = 200;
const STEPS_PER_AGENT = 5;

const BUTTON = "rounded-md px-3 py-1.5 text-sm font-medium";
const PRIMARY = `${BUTTON} bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900`;
const SECONDARY = `${BUTTON} border border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300`;
const FIELD =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100";
const CARD = "rounded-lg border border-black/[0.08] bg-white p-4 dark:border-white/[0.1] dark:bg-white/[0.03]";

function StatusButton({ id, status, text, primary }: { id: number; status: ContentDraftStatus; text: string; primary?: boolean }) {
  return (
    <form action={setDraftStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className={primary ? PRIMARY : SECONDARY}>
        {text}
      </button>
    </form>
  );
}

function SkipForm({ id }: { id: number }) {
  return (
    <form action={setDraftStatusAction} className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value="skipped" />
      <input
        type="text"
        name="reason"
        maxLength={500}
        placeholder="Reason (optional)"
        aria-label="Reason for skipping (optional)"
        className={`${FIELD} min-w-0 flex-1 sm:w-52 sm:flex-none`}
      />
      <button type="submit" className={SECONDARY}>
        Skip
      </button>
    </form>
  );
}

function QueueItem({ item }: { item: ContentDraft }) {
  const hasCard = item.kind === "linkedin_post" && item.facts.source !== "intake";
  return (
    <li className={CARD}>
      <div className="space-y-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">
            {item.agent} · {label(item.kind)} · {item.channel} · filed {formatAdminDateTime(item.createdAt)}
          </p>
          {item.status === "draft" ? null : (
            <h3 className="mt-1 break-words text-base font-semibold text-gray-900 dark:text-gray-100">{item.title}</h3>
          )}
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
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
          </div>
          {item.status === "skipped" ? (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {item.skipReason ? `Skipped: ${item.skipReason}` : "Skipped with no reason given."}
            </p>
          ) : null}
          {item.status === "posted" ? (
            <p className="mt-1 text-xs text-gray-500">
              Done {formatAdminDateTime(item.postedAt ?? item.reviewedAt)}
              {item.score !== null ? ` · Score: ${item.score} tracked visits in the week after` : item.scoredAt ? " · Checked, no measure for this kind" : " · Not scored yet"}
            </p>
          ) : null}
        </div>

        {item.status === "draft" ? (
          <form action={saveDraftTextAction} className="space-y-2">
            <input type="hidden" name="id" value={item.id} />
            <label className="block text-xs text-gray-500">
              Title
              <input type="text" name="title" defaultValue={item.title} maxLength={200} required className={`${FIELD} mt-1 font-semibold`} />
            </label>
            <label className="block text-xs text-gray-500">
              Text
              <textarea name="body" defaultValue={item.caption} rows={8} required className={`${FIELD} mt-1`} />
            </label>
            <button type="submit" className="text-sm text-gray-600 underline dark:text-gray-400">
              Save edits
            </button>
          </form>
        ) : (
          <details>
            <summary className="cursor-pointer text-sm text-gray-600 dark:text-gray-400">Show text</summary>
            <p className="mt-2 whitespace-pre-line break-words text-sm text-gray-700 dark:text-gray-300">{item.caption}</p>
          </details>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {item.status === "draft" ? <StatusButton id={item.id} status="approved" text="Approve" primary /> : null}
          {item.status === "approved" ? <StatusButton id={item.id} status="posted" text="Mark done" primary /> : null}
          {item.status === "draft" || item.status === "approved" ? <SkipForm id={item.id} /> : null}
          {item.status === "skipped" ? <StatusButton id={item.id} status="draft" text="Back to review" /> : null}
        </div>
      </div>
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

function Filters({ filter }: { filter: QueueFilter }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-12 text-xs uppercase tracking-wide text-gray-500">Agent</span>
        <Chip href={filterHref(filter, { agent: null })} active={!filter.agent}>
          All
        </Chip>
        {GROWTH_AGENTS.map((agent) => (
          <Chip key={agent} href={filterHref(filter, { agent })} active={filter.agent === agent}>
            {agent}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-12 text-xs uppercase tracking-wide text-gray-500">Kind</span>
        <Chip href={filterHref(filter, { kind: null })} active={!filter.kind}>
          All
        </Chip>
        {QUEUE_KINDS.map((kind) => (
          <Chip key={kind} href={filterHref(filter, { kind })} active={filter.kind === kind}>
            {label(kind)}
          </Chip>
        ))}
      </div>
    </div>
  );
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
        <p className="text-sm text-gray-500">
          {agent ? GROWTH_AGENT_ROLES[agent] : "Growth's steps no single agent owns yet: the monthly email and the weekly scoring."}
        </p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-500">Recent steps</p>
        {steps === null ? (
          <p className="mt-1 text-sm text-gray-500">Couldn&apos;t read the run ledger.</p>
        ) : steps.length ? (
          <ul className="mt-2 space-y-2">
            {steps.slice(0, STEPS_PER_AGENT).map((step) => (
              <StepRow key={step.stepId} step={step} />
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-gray-500">No runs on the ledger yet.</p>
        )}
      </div>
      {agent ? (
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">Lessons from your skips</p>
          {lessons === null || lessons === undefined ? (
            <p className="mt-1 text-sm text-gray-500">Couldn&apos;t read the lessons.</p>
          ) : lessons.length ? (
            <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
              {lessons.map((lesson) => (
                <li key={`${lesson.draftId}-${lesson.at}`} className="break-words">
                  &ldquo;{lesson.title}&rdquo; skipped: {lesson.reason}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-gray-500">No lessons yet.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

/** What the page read. `null` means the read failed, shown as unread rather than empty. */
export interface GrowthBoardData {
  filter: QueueFilter;
  /** Whether content_drafts exists (`null`: couldn't tell). */
  ready: boolean | null;
  items: ContentDraft[] | null;
  control: AutomationControlState | null;
  budget: GrowthBudgetState | null;
  steps: GrowthStep[] | null;
  lessons: Map<GrowthAgent, GrowthLesson[] | null>;
}

/** The approval page's body, drawn from what `page.tsx` read. */
export function GrowthBoard({ filter, ready, items, control, budget, steps, lessons }: GrowthBoardData) {
  const shown = items ? filterQueue(items, filter) : [];
  const filtered = Boolean(filter.agent || filter.kind);

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-gray-500">
          <Link href="/admin/customers" className="underline">
            Customers
          </Link>{" "}
          · Growth
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">Growth approvals</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Everything the marketing team drafts or opens waits here for you: posts, emails, briefs and pull requests. Approving or marking
          something done changes only this queue. Nothing posts or sends from this page.
        </p>
      </header>

      <dl className="grid gap-3 sm:grid-cols-2">
        <div className={CARD}>
          <dt className="text-xs uppercase tracking-wide text-gray-500">Marketing</dt>
          <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{marketingLine(control)}</dd>
        </div>
        <div className={CARD}>
          <dt className="text-xs uppercase tracking-wide text-gray-500">Budget (agent:growth)</dt>
          <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{budgetLine(budget)}</dd>
        </div>
      </dl>

      <section className="space-y-6">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Queue</h2>
          <Filters filter={filter} />
        </div>

        {ready === false ? (
          <p className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
            The content_drafts table doesn&apos;t exist yet, so there is nothing to show.
          </p>
        ) : items === null ? (
          <p className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">Couldn&apos;t read the queue.</p>
        ) : null}

        {items
          ? QUEUE_SECTIONS.map((section) => {
              const list = shown.filter((item) => item.status === section.status);
              return (
                <section key={section.status} className="space-y-3">
                  <div>
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                      {section.title} ({list.length})
                    </h3>
                    <p className="text-sm text-gray-500">{section.note}</p>
                  </div>
                  {list.length ? (
                    <ul className="space-y-4">
                      {list.map((item) => (
                        <QueueItem key={item.id} item={item} />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-gray-500">{filtered ? `${section.empty.replace(/\.$/, "")} for this filter.` : section.empty}</p>
                  )}
                </section>
              );
            })
          : null}
        {items && items.length >= QUEUE_LIMIT ? (
          <p className="text-xs text-gray-500">Showing the newest {QUEUE_LIMIT} items.</p>
        ) : null}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">The team</h2>
          <p className="text-sm text-gray-500">
            Each agent&apos;s newest steps on the run ledger (agent growth) and the standing lessons from your skip reasons.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {GROWTH_AGENTS.map((agent) => (
            <AgentSection key={agent} agent={agent} steps={steps ? steps.filter((step) => step.agent === agent) : null} lessons={lessons.get(agent)} />
          ))}
          <AgentSection agent={null} steps={steps ? steps.filter((step) => step.agent === null) : null} lessons={null} />
        </div>
      </section>
    </div>
  );
}
