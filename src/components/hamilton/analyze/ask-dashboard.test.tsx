// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvidencePanel } from "./EvidencePanel";
import { QuestionRail } from "./QuestionRail";
import { StorylineView } from "@/components/hamilton/storyline/StorylineView";
import { exhibitTabLabels } from "@/components/hamilton/storyline/ExhibitTabs";
import { sampleStoryline } from "@/components/hamilton/storyline/test-fixture";

vi.mock("@/app/pro/(hamilton)/monitor/actions", () => ({ addToWatchlist: vi.fn() }));

afterEach(() => {
  cleanup();
  try { window.localStorage.clear(); } catch { /* none */ }
});

const CITE = "page 2, line 4 of our stored copy of the bank's fee schedule";

describe("EvidencePanel", () => {
  it("numbers each source, opens the first, and keeps the citation wording whole", () => {
    render(
      <EvidencePanel
        sources={[
          { n: 1, label: "Example Bank: Overdraft Item Fee", amount: "$35", details: ["Published Oct 20, 2026"], location: CITE, url: "https://example.com/fees.pdf" },
          { n: 2, label: "Bank Fee Index peer fees", details: ["18 institutions behind the figure"] },
        ]}
      />,
    );
    const first = screen.getByRole("button", { name: /Source 1: Example Bank: Overdraft Item Fee/ });
    expect(first.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(`Cited at ${CITE}.`)).toBeTruthy();
    const second = screen.getByRole("button", { name: /Source 2/ });
    expect(second.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("18 institutions behind the figure")).toBeNull();
    fireEvent.click(second);
    expect(second.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("18 institutions behind the figure")).toBeTruthy();
  });

  it("names no place for a source without a location", () => {
    render(<EvidencePanel sources={[{ n: 1, label: "Bank Fee Index peer fees", details: ["As of Oct 1, 2026"] }]} />);
    expect(document.body.textContent).not.toContain("stored copy");
  });
});

describe("QuestionRail", () => {
  const questions = [
    { id: "a", title: "How does our overdraft fee compare with Florida banks?", updated_at: "2026-11-01T10:00:00Z" },
    { id: "b", title: "Which peers charge less for a domestic wire?", updated_at: "2026-10-30T10:00:00Z" },
  ];

  it("lists saved questions, marks the open one and filters by a word", () => {
    render(<QuestionRail userId={7} questions={questions} currentId="a" institutionId="2945" />);
    const open = screen.getByRole("link", { name: /overdraft fee/ });
    expect(open.getAttribute("aria-current")).toBe("page");
    expect(open.getAttribute("href")).toContain("/pro/analyze?analysis=a");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search your questions" }), { target: { value: "wire" } });
    expect(screen.queryByRole("link", { name: /overdraft fee/ })).toBeNull();
    expect(screen.getByRole("link", { name: /domestic wire/ })).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    expect(screen.getByText("No questions match.")).toBeTruthy();
  });

  it("pins a question to the top on this device", () => {
    render(<QuestionRail userId={7} questions={questions} currentId={null} institutionId={null} />);
    const pin = screen.getByRole("button", { name: /^Pin: Which peers/ });
    expect(pin.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(pin);
    const pinned = screen.getByRole("list", { name: "Pinned" });
    expect(within(pinned).getByRole("link", { name: /domestic wire/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Unpin: Which peers/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows no search field when nothing is saved", () => {
    render(<QuestionRail userId={7} questions={[]} currentId={null} institutionId={null} />);
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getByText("Questions you ask are saved here.")).toBeTruthy();
  });
});

describe("StorylineView dashboard layout", () => {
  it("shows the key figures as tiles, one exhibit at a time and the numbered evidence", () => {
    const story = sampleStoryline();
    render(<StorylineView story={story} layout="dashboard" />);
    expect(screen.getByText(story.governingThought)).toBeTruthy();
    for (const f of story.keyFigures.slice(0, 4)) expect(screen.getAllByText(f.value).length).toBeGreaterThan(0);
    const tabs = screen.getByRole("group", { name: "Choose a chart" });
    const buttons = within(tabs).getAllByRole("button");
    expect(buttons).toHaveLength(story.exhibits.length);
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect(document.body.textContent).toContain("Exhibit 1");
    expect(document.body.textContent).not.toContain("Exhibit 2");
    fireEvent.click(buttons[1]);
    expect(buttons[1].getAttribute("aria-pressed")).toBe("true");
    expect(document.body.textContent).toContain("Exhibit 2");
    expect(screen.getByRole("heading", { name: "Evidence" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Source 1:/ })).toBeTruthy();
  });

  it("lists a published row it quotes with its citation whole", () => {
    const row = {
      id: 1, feeName: "Overdraft Item Fee", amount: 35, sourceDocumentId: 9, documentUrl: "https://example.com/fees.pdf", sourceUrl: null,
      publishedAt: "2026-10-20T00:00:00Z", verifiedByEventId: null, sourceLocation: CITE,
    };
    render(<StorylineView story={sampleStoryline()} layout="dashboard" ownRows={{ institutionName: "Example Bank", rows: [row] }} />);
    const button = screen.getByRole("button", { name: /Example Bank: Overdraft Item Fee/ });
    fireEvent.click(button);
    expect(screen.getByText(`Cited at ${CITE}.`)).toBeTruthy();
  });

  it("names a repeated kind of exhibit by its number", () => {
    const items = sampleStoryline().exhibits;
    const labels = exhibitTabLabels(items);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
