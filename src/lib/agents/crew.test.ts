import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { CREW, deriveCrewMember, feedItemFromRow, type CrewSignals } from "./crew";

const magellan = CREW.find((member) => member.agent === "magellan")!;
const atlas = CREW.find((member) => member.agent === "atlas")!;
const quiet: CrewSignals = {
  runningStep: null,
  queuedSteps: 0,
  activeRuns: 0,
  lastItem: null,
  failedRecently: false,
  doneToday: 0,
};

describe("deriveCrewMember", () => {
  it("is idle with nothing queued", () => {
    expect(deriveCrewMember(magellan, quiet)).toMatchObject({ state: "idle", now: "Nothing to do right now." });
  });

  it("is working while one of its steps runs", () => {
    const status = deriveCrewMember(magellan, {
      ...quiet,
      runningStep: { title: "Fetch state source documents", stateCode: "GA" },
    });
    expect(status).toMatchObject({ state: "working", now: "Fetch state source documents (GA)." });
  });

  it("is waiting when its steps are queued", () => {
    expect(deriveCrewMember(magellan, { ...quiet, queuedSteps: 3 }).state).toBe("waiting");
  });

  it("is blocked when its last job failed and it is not working", () => {
    expect(deriveCrewMember(magellan, { ...quiet, failedRecently: true }).state).toBe("blocked");
  });

  it("shows Atlas coordinating whenever runs are active", () => {
    expect(deriveCrewMember(atlas, { ...quiet, activeRuns: 2 })).toMatchObject({
      state: "working",
      now: "Coordinating 2 runs.",
    });
  });
});

describe("feedItemFromRow", () => {
  it("narrates a finished fetch and attributes it to the step's agent", () => {
    const item = feedItemFromRow({
      id: 9,
      created_at: "2026-10-02T10:42:00Z",
      event_type: "step.finished",
      status: "completed",
      message: "",
      detail: JSON.stringify({ processed_institutions: 25, fetched_documents: 25 }),
      step_key: "fetch",
      step_agent: "magellan",
      run_agent: "atlas",
      state_code: "GA",
      run_id: 300,
    });
    expect(item).toMatchObject({
      agent: "magellan",
      tone: "ok",
      text: "Downloaded 25 fee schedules in GA.",
      runId: 300,
    });
  });

  it("drops events that have nothing to say", () => {
    expect(feedItemFromRow({
      id: 1, created_at: "2026-10-02T10:00:00Z", event_type: "step.finished", status: "completed",
      message: "", detail: {}, step_key: "public-cluster", step_agent: "darwin", run_agent: "atlas",
      state_code: "GA", run_id: 1,
    })).toBeNull();
  });
});
