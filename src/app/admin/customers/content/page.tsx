export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { formatAdminDateTime } from "@/lib/admin-time";
import { contentSchemaReady, listContentDrafts, type ContentDraft, type ContentDraftStatus } from "@/lib/data-store/content-drafts";
import { money } from "@/lib/agents/content/market-spread";
import { saveCaptionAction, setDraftStatusAction } from "./actions";

const SECTIONS: { status: ContentDraftStatus; title: string; note: string }[] = [
  { status: "draft", title: "Waiting for your review", note: "Approve, edit or skip. Nothing posts from this page." },
  { status: "approved", title: "Approved, ready to post", note: "Download the card, copy the caption, post it on the company page, then mark it posted." },
  { status: "posted", title: "Posted", note: "Scored monthly from the tracked links." },
  { status: "skipped", title: "Skipped", note: "Not re-proposed for eight weeks." },
];

const WORKFLOW_LABELS: Record<string, string> = { "w1-market-spread": "Market spread", "w3-fee-depth": "Fee depth at work" };

function StatusButton({ id, status, label, primary }: { id: number; status: ContentDraftStatus; label: string; primary?: boolean }) {
  return (
    <form action={setDraftStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button
        type="submit"
        className={`rounded-md px-3 py-1.5 text-sm font-medium ${
          primary ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900" : "border border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300"
        }`}
      >
        {label}
      </button>
    </form>
  );
}

function Facts({ draft }: { draft: ContentDraft }) {
  const f = draft.facts as Record<string, number | string | undefined>;
  const cell = (label: string, value: string) => (
    <div>
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-900 dark:text-gray-100">{value}</dd>
    </div>
  );
  if (f.kind === "depth") {
    return (
      <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-xs">
        {cell("Use case", String(f.use_case_label))}
        {cell("Full schedules", String(f.full_schedules))}
        {cell("Typical fee types", String(f.median_types))}
      </dl>
    );
  }
  if (typeof f.low !== "number") return null;
  return (
    <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-xs sm:grid-cols-6">
      {cell("Institutions", String(f.institutions))}
      {cell("Lowest", money(Number(f.low)))}
      {cell("Middle half from", money(Number(f.p25)))}
      {cell("Median", money(Number(f.median)))}
      {cell("Middle half to", money(Number(f.p75)))}
      {cell("Highest", money(Number(f.high)))}
    </dl>
  );
}

function DraftCard({ draft }: { draft: ContentDraft }) {
  const card = `/api/admin/content/card/${draft.id}`;
  const editable = draft.status === "draft" || draft.status === "approved";
  return (
    <li className="rounded-lg border border-black/[0.08] bg-white p-4 dark:border-white/[0.1] dark:bg-white/[0.03]">
      <div className="flex flex-col gap-4 md:flex-row">
        <a href={card} target="_blank" rel="noreferrer" className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={card} alt={`Card: ${draft.title}`} width={220} height={220} className="rounded border border-black/[0.06]" loading="lazy" />
        </a>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">
              {WORKFLOW_LABELS[draft.workflow] ?? draft.workflow} · {draft.channel} · as of {formatAdminDateTime(draft.asOf)}
            </p>
            <h3 className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">{draft.title}</h3>
          </div>
          <Facts draft={draft} />
          {editable ? (
            <form action={saveCaptionAction} className="space-y-2">
              <input type="hidden" name="id" value={draft.id} />
              <textarea
                name="caption"
                defaultValue={draft.caption}
                rows={9}
                className="w-full rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              />
              <button type="submit" className="text-sm text-gray-600 underline dark:text-gray-400">
                Save caption
              </button>
            </form>
          ) : (
            <p className="whitespace-pre-line text-sm text-gray-700 dark:text-gray-300">{draft.caption}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {draft.status === "draft" ? <StatusButton id={draft.id} status="approved" label="Approve" primary /> : null}
            {draft.status === "approved" ? <StatusButton id={draft.id} status="posted" label="Mark posted" primary /> : null}
            {draft.status === "draft" || draft.status === "approved" ? <StatusButton id={draft.id} status="skipped" label="Skip" /> : null}
            {draft.status === "skipped" ? <StatusButton id={draft.id} status="draft" label="Back to review" /> : null}
            <a href={card} download={`fee-insight-${draft.id}.png`} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300">
              Download card
            </a>
          </div>
          {typeof draft.facts.method === "string" ? <p className="text-xs text-gray-500">Method: {draft.facts.method}</p> : null}
        </div>
      </div>
    </li>
  );
}

/** The content queue: every post the content workflows drafted, waiting for James. */
export default async function ContentQueuePage() {
  await requireAuth("view");
  const ready = await contentSchemaReady().catch(() => false);
  const drafts = ready ? await listContentDrafts(80) : [];

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-6 py-8">
      <header>
        <p className="text-xs uppercase tracking-wide text-gray-500">
          <Link href="/admin/customers" className="underline">Customers</Link> · Content
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">Content queue</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Each Sunday the content run drafts next week&apos;s posts from live fee data. Every number on a card and in a caption comes from
          that run&apos;s query, and drafts that fail the checks are never queued. Nothing posts on its own.
        </p>
      </header>

      {!ready ? (
        <p className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          The content_drafts table doesn&apos;t exist yet, so there is nothing to show.
        </p>
      ) : null}

      {SECTIONS.map((section) => {
        const list = drafts.filter((draft) => draft.status === section.status);
        if (list.length === 0 && section.status !== "draft") return null;
        return (
          <section key={section.status} className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {section.title} ({list.length})
              </h2>
              <p className="text-sm text-gray-500">{section.note}</p>
            </div>
            {list.length ? (
              <ul className="space-y-4">
                {list.map((draft) => (
                  <DraftCard key={draft.id} draft={draft} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">Nothing waiting.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
