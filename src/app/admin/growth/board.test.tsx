// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentDraft } from "@/lib/data-store/content-drafts";
import type { GrowthLesson } from "@/lib/agents/growth/lessons";
import { GROWTH_AGENTS, QUEUE_KINDS } from "@/lib/agents/growth/roster";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("../customers/content/actions", () => ({ saveDraftTextAction: vi.fn(), setDraftStatusAction: vi.fn() }));

import { GrowthBoard, type GrowthBoardData } from "./board";

afterEach(cleanup);

function data(overrides: Partial<GrowthBoardData> = {}): GrowthBoardData {
  return {
    view: "review",
    filter: { agent: null, kind: null },
    ready: true,
    items: [],
    control: { enabled: true, reason: null, changedBy: "system", changedAt: "2026-10-08T00:00:00Z", revision: 0 },
    budget: { state: "off", dailyCapUsd: 5, monthlyCapUsd: 60 },
    steps: [],
    lessons: new Map(GROWTH_AGENTS.map((agent) => [agent, []])),
    ...overrides,
  };
}

function draft(overrides: Partial<ContentDraft>): ContentDraft {
  return {
    id: 1,
    agent: "ernest",
    kind: "pull_request",
    workflow: "intake:ernest",
    channel: "github",
    subjectKey: "k",
    title: "Article PR",
    caption: "Body",
    facts: { source: "intake" },
    asOf: "2026-10-08T00:00:00Z",
    status: "draft",
    agentRunId: 3,
    reviewedBy: null,
    reviewedAt: null,
    postedAt: null,
    createdAt: "2026-10-08T00:00:00Z",
    skipReason: null,
    prUrl: "https://github.com/x/y/pull/9",
    score: null,
    scoredAt: null,
    ...overrides,
  };
}

describe("GrowthBoard", () => {
  it("says plainly when nothing is waiting, with one short status line", () => {
    const { container } = render(<GrowthBoard {...data()} />);
    expect(screen.getByText("Nothing waiting for review.")).toBeTruthy();
    expect(container.querySelector("summary")?.textContent).toBe("Marketing running · Growth budget off");
    // The full wording stays one tap away.
    expect(screen.getByText(/^Off\. .*Caps: \$5\.00 a day, \$60\.00 a month\./)).toBeTruthy();
    expect(screen.getByText(/^Running\./)).toBeTruthy();
    // Only the chosen view renders: no team cards on the review view.
    expect(screen.queryByText("No runs on the ledger yet.")).toBeNull();
    expect(screen.queryByText(/No activity yet/)).toBeNull();
  });

  it("draws one tab row with counts, the chosen view marked, and links that keep the filter", () => {
    const items = [draft({}), draft({ id: 2 }), draft({ id: 3, status: "approved" })];
    render(<GrowthBoard {...data({ view: "approved", filter: { agent: "ernest", kind: null }, items })} />);
    const nav = screen.getByRole("navigation", { name: "Growth views" });
    const tabs = Array.from(nav.querySelectorAll("a")).map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("aria-current")]);
    expect(tabs).toEqual([
      ["To review (2)", "/admin/growth?agent=ernest", null],
      ["Approved (1)", "/admin/growth?view=approved&agent=ernest", "page"],
      ["Done", "/admin/growth?view=done&agent=ernest", null],
      ["Skipped", "/admin/growth?view=skipped&agent=ernest", null],
      ["Team", "/admin/growth?view=team&agent=ernest", null],
    ]);
    // Approved view shows only the approved item.
    expect(screen.getByRole("button", { name: "Mark done" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("shows unread reads as unread, not empty", () => {
    const { container } = render(<GrowthBoard {...data({ items: null, control: null, budget: null, steps: null })} />);
    expect(screen.getByText("Couldn't read the queue.")).toBeTruthy();
    expect(container.querySelector("summary")?.textContent).toBe("Marketing unread · Growth budget unread");
    expect(screen.getByText("Couldn't read the marketing control.")).toBeTruthy();
    expect(screen.getByText("Couldn't read the agent:growth budget.")).toBeTruthy();
    expect(screen.queryByText("Nothing waiting for review.")).toBeNull();
    expect(screen.getByRole("link", { name: "To review" })).toBeTruthy();
  });

  it("shows a draft as a compact card with Approve up front and Skip and Edit folded away", () => {
    const { container } = render(<GrowthBoard {...data({ items: [draft({ caption: "Line one\nLine two\nLine three" })] })} />);
    expect(screen.getByText("ernest · pull request")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Article PR" })).toBeTruthy();
    expect(container.querySelector("p.line-clamp-2")?.textContent).toBe("Line one\nLine two\nLine three");
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    // No fields on load: Skip and Edit open them underneath, one at a time.
    expect(container.querySelector("input[type=text], textarea")).toBeNull();
    const skip = screen.getByRole("button", { name: "Skip" });
    const edit = screen.getByRole("button", { name: "Edit" });
    expect(skip.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(skip);
    expect(skip.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText("Reason for skipping (optional)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm skip" })).toBeTruthy();
    fireEvent.click(edit);
    expect(screen.queryByRole("button", { name: "Confirm skip" })).toBeNull();
    expect(container.querySelector("textarea[name=body]")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save edits" })).toBeTruthy();
    expect(screen.getByDisplayValue("Article PR")).toBeTruthy();
    fireEvent.click(edit);
    expect(container.querySelector("textarea")).toBeNull();
    // The PR link and full text sit under "More".
    expect(screen.getByRole("link", { name: "Pull request" }).getAttribute("href")).toBe("https://github.com/x/y/pull/9");
  });

  it("offers mark done and skip once approved, and back to review once skipped", () => {
    const items = [draft({ status: "approved" }), draft({ id: 2, status: "skipped", skipReason: "Off brand" })];
    const { unmount } = render(<GrowthBoard {...data({ view: "approved", items })} />);
    expect(screen.getByRole("button", { name: "Mark done" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.getByRole("button", { name: "Confirm skip" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    unmount();
    render(<GrowthBoard {...data({ view: "skipped", items })} />);
    expect(screen.getByText("Skipped: Off brand")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to review" })).toBeTruthy();
  });

  it("folds the filters behind one disclosure and shows a set filter as one clearing chip", () => {
    const { container } = render(<GrowthBoard {...data({ view: "done", filter: { agent: "murrow", kind: "linkedin_post" }, items: [draft({})] })} />);
    expect(screen.getByText("Nothing is marked done yet for this filter.")).toBeTruthy();
    const chip = screen.getByRole("link", { name: "Clear filter: murrow · linkedin post" });
    expect(chip.getAttribute("href")).toBe("/admin/growth?view=done");
    const filter = Array.from(container.querySelectorAll("details")).find((d) => d.querySelector("summary")?.textContent === "Filter");
    expect(filter?.open).toBe(false);
    expect(filter?.querySelectorAll("a")).toHaveLength(GROWTH_AGENTS.length + 1 + QUEUE_KINDS.length + 1);
    expect(screen.getByRole("link", { name: "ernest" }).getAttribute("href")).toBe("/admin/growth?view=done&agent=ernest&kind=linkedin_post");
  });

  it("no chip when no filter is set", () => {
    render(<GrowthBoard {...data()} />);
    expect(screen.queryByRole("link", { name: /^Clear filter/ })).toBeNull();
  });

  it("team view keeps agents with runs or lessons and folds the quiet ones into one line", () => {
    const step = {
      stepId: 1,
      runId: 7,
      stepKey: "marketing-write",
      title: "Drafted a post",
      status: "succeeded",
      summary: "One post filed",
      errorSummary: null,
      runTitle: "Growth",
      runStatus: "succeeded",
      at: "2026-10-08T00:00:00Z",
      completedAt: null,
      agent: "murrow" as const,
    };
    const lessons = new Map(GROWTH_AGENTS.map((agent) => [agent, [] as GrowthLesson[]]));
    lessons.set("ernest", [{ draftId: 4, agent: "ernest", kind: "article", workflow: null, subjectKey: null, title: "Old post", reason: "Too long", at: "2026-10-07T00:00:00Z" }]);
    render(<GrowthBoard {...data({ view: "team", steps: [step], lessons })} />);
    expect(screen.getByRole("heading", { name: "MURROW" })).toBeTruthy();
    expect(screen.getByText("Drafted a post")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "ERNEST" })).toBeTruthy();
    expect(screen.getByText(/Too long/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "CARNEGIE" })).toBeNull();
    expect(screen.getByText("No activity yet: bernays, carnegie, draper, edison, nielsen, norman, sherlock, team work.")).toBeTruthy();
    // No queue on the team view.
    expect(screen.queryByText("Nothing waiting for review.")).toBeNull();
  });

  it("team view keeps an agent's card when its reads failed", () => {
    render(<GrowthBoard {...data({ view: "team", steps: null })} />);
    expect(screen.getAllByText("Couldn't read the run ledger.")).toHaveLength(GROWTH_AGENTS.length + 1);
    expect(screen.queryByText(/No activity yet/)).toBeNull();
  });
});
