// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrewLive } from "./crew-live";
import type { CrewFeedItem, CrewMemberStatus } from "@/lib/agents/crew";

const crew: CrewMemberStatus[] = [
  {
    agent: "magellan", name: "Magellan", role: "Finds and downloads fee schedules", href: "/admin/magellan",
    state: "working", now: "Fetch state source documents (GA).", last: "Downloaded 25 fee schedules in GA.",
    lastAt: "2026-10-02T10:42:00Z", doneToday: 3,
    lastAttemptAt: "2026-10-02T10:40:00Z", lastSuccessAt: "2026-10-02T10:42:00Z", nextRunAt: null,
  },
  {
    agent: "knox", name: "Knox", role: "Pulls fees out of documents", href: "/admin/knox",
    state: "blocked", now: "My last job failed. See the log below.", last: null, lastAt: null, doneToday: 0,
    lastAttemptAt: "2026-10-02T10:46:00Z", lastSuccessAt: null, nextRunAt: null,
  },
];

const feed: CrewFeedItem[] = [
  { id: 2, at: "2026-10-02T10:47:00Z", agent: "knox", runId: 5, stateCode: "GA", tone: "error", text: "Stopped with an error" },
  { id: 1, at: "2026-10-02T10:42:00Z", agent: "magellan", runId: 5, stateCode: "GA", tone: "ok", text: "Downloaded 25 fee schedules in GA." },
];

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false } as Response);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CrewLive", () => {
  it("shows Unknown and the last success, last try and next run", () => {
    const unknown: CrewMemberStatus = {
      ...crew[0], agent: "rosetta", name: "Rosetta", state: "unknown", now: "Status unknown: the run ledger could not be read.",
      nextRunAt: "2026-10-02T11:00:00Z",
    };
    render(<CrewLive initialCrew={[...crew, unknown]} initialFeed={feed} />);
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.getByText(/Last success: none in 30 days · last try/)).toBeTruthy();
    expect(screen.getAllByText(/next scheduled/).length).toBe(1);
  });

  it("shows each worker's state, now and last", () => {
    render(<CrewLive initialCrew={crew} initialFeed={feed} />);
    expect(screen.getByText("Working")).toBeTruthy();
    expect(screen.getByText("Blocked")).toBeTruthy();
    expect(screen.getByText("Fetch state source documents (GA).")).toBeTruthy();
    expect(screen.getAllByText("Downloaded 25 fee schedules in GA.").length).toBeGreaterThan(0);
  });

  it("opens each worker's screen from its card", () => {
    render(<CrewLive initialCrew={crew} initialFeed={feed} />);
    expect(screen.getByRole("link", { name: /Magellan/ }).getAttribute("href")).toBe("/admin/magellan");
    expect(screen.getByRole("link", { name: /Knox/ }).getAttribute("href")).toBe("/admin/knox");
  });

  it("filters the activity log to one worker from the Show menu", () => {
    render(<CrewLive initialCrew={crew} initialFeed={feed} />);
    expect(screen.getByText("Stopped with an error")).toBeTruthy();
    const select = screen.getByLabelText(/Show/);
    fireEvent.change(select, { target: { value: "magellan" } });
    expect(screen.queryByText("Stopped with an error")).toBeNull();
    expect(screen.getByText("Activity log · Magellan")).toBeTruthy();
    fireEvent.change(select, { target: { value: "" } });
    expect(screen.getByText("Stopped with an error")).toBeTruthy();
  });
});
