/**
 * The "Your work" room's piles (#1122 step 3): what only James can do, each with its size, its
 * oldest item when known, and where to act. Pure; the page passes what it could read, and a pile
 * whose read failed says so instead of showing zero.
 */

export interface WorkPile {
  key: string;
  title: string;
  href: string;
  /** null when the read failed or the count is not kept here. */
  count: number | null;
  /** What `count` counts, in plain words. */
  unit: string;
  /** ISO date of the oldest waiting item, when the pile keeps one. */
  oldest: string | null;
  /** One line on what acting on the pile does. */
  wayOut: string;
  /** Why there is no count, when there is none. */
  note?: string;
}

export interface WorkPileInputs {
  labels: number | null;
  answerKeyToCheck: number | null;
  trustPending: number | null;
  contentDrafts: Array<{ createdAt: string }> | null;
  verifyCandidates: number | null;
  verifyLimit: number;
}

function oldestOf(rows: Array<{ createdAt: string }>): string | null {
  const times = rows.map((row) => Date.parse(row.createdAt)).filter((time) => Number.isFinite(time));
  return times.length === 0 ? null : new Date(Math.min(...times)).toISOString();
}

export function workPiles(input: WorkPileInputs): WorkPile[] {
  const unreadable = "Could not be read just now.";
  return [
    {
      key: "labels",
      title: "Fee names to label",
      href: "/admin/knox/labels",
      count: input.labels,
      unit: "names",
      oldest: null,
      wayOut: "Pick the category; Knox uses it from the next extract.",
      ...(input.labels == null ? { note: unreadable } : {}),
    },
    {
      key: "answer-key",
      title: "Answer-key banks to check",
      href: "/admin/answer-key",
      count: input.answerKeyToCheck,
      unit: "banks not yet checked by a person",
      oldest: null,
      wayOut: "Confirm or correct each fee; the pipeline is scored against it.",
      ...(input.answerKeyToCheck == null ? { note: unreadable } : {}),
    },
    {
      key: "trust",
      title: "Sources to review",
      href: "/admin/quality",
      count: input.trustPending,
      unit: "submitted sources pending",
      oldest: null,
      wayOut: "Accept or reject each submitted source.",
      ...(input.trustPending == null ? { note: unreadable } : {}),
    },
    {
      key: "content",
      title: "Posts to approve",
      href: "/admin/customers/content",
      count: input.contentDrafts == null ? null : input.contentDrafts.length,
      unit: "drafts waiting (of the newest 80)",
      oldest: input.contentDrafts == null ? null : oldestOf(input.contentDrafts),
      wayOut: "Approve or skip each draft; nothing posts without you.",
      ...(input.contentDrafts == null ? { note: unreadable } : {}),
    },
    {
      key: "verify",
      title: "Banks to sample by hand",
      href: "/admin/knox?queue=gold",
      count: input.verifyCandidates,
      unit: input.verifyCandidates != null && input.verifyCandidates >= input.verifyLimit ? `banks shown (the first ${input.verifyLimit})` : "banks ready",
      oldest: null,
      wayOut: "Check a bank's live fees against its schedule.",
      ...(input.verifyCandidates == null ? { note: unreadable } : {}),
    },
    {
      key: "marketing",
      title: "Monthly emails to approve",
      href: "/admin/customers/marketing",
      count: null,
      unit: "",
      oldest: null,
      wayOut: "Approve each campaign in MailerLite; nothing sends without you.",
      note: "Counted in MailerLite, not here; marketing is paused (#1121).",
    },
  ];
}
