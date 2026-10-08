// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentDraft } from "@/lib/data-store/content-drafts";
import { GROWTH_AGENTS } from "@/lib/agents/growth/roster";

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
  it("says plainly when nothing is there yet", () => {
    render(<GrowthBoard {...data()} />);
    expect(screen.getByText("Nothing is waiting for review.")).toBeTruthy();
    expect(screen.getAllByText("No runs on the ledger yet.")).toHaveLength(GROWTH_AGENTS.length + 1);
    expect(screen.getAllByText("No lessons yet.")).toHaveLength(GROWTH_AGENTS.length);
    expect(screen.getByText(/^Off\. .*Caps: \$5\.00 a day, \$60\.00 a month\./)).toBeTruthy();
    expect(screen.getByText(/^Running\./)).toBeTruthy();
  });

  it("shows unread reads as unread, not empty", () => {
    render(<GrowthBoard {...data({ items: null, control: null, budget: null, steps: null })} />);
    expect(screen.getByText("Couldn't read the queue.")).toBeTruthy();
    expect(screen.getByText("Couldn't read the marketing control.")).toBeTruthy();
    expect(screen.getByText("Couldn't read the agent:growth budget.")).toBeTruthy();
    expect(screen.queryByText("Nothing is waiting for review.")).toBeNull();
  });

  it("offers approve, edit, skip and the PR link on a draft, and mark done once approved", () => {
    render(<GrowthBoard {...data({ items: [draft({}), draft({ id: 2, status: "approved", title: "Approved PR" })] })} />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save edits" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark done" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Skip" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Pull request" })[0].getAttribute("href")).toBe("https://github.com/x/y/pull/9");
    expect(screen.getByDisplayValue("Article PR")).toBeTruthy();
  });

  it("filters the queue by agent", () => {
    render(<GrowthBoard {...data({ filter: { agent: "murrow", kind: null }, items: [draft({})] })} />);
    expect(screen.getByText("Nothing is waiting for review for this filter.")).toBeTruthy();
  });
});
