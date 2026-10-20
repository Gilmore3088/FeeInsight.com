import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  setPipelineEnabled: vi.fn(),
  getPipelineControl: vi.fn(),
  startAgentRun: vi.fn(),
  startStateLaneRun: vi.fn(),
  scheduleDueStateLaneRuns: vi.fn(),
}));

vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql }));
vi.mock("@/lib/automation-control", () => ({
  setPipelineEnabled: mocks.setPipelineEnabled,
  getPipelineControl: mocks.getPipelineControl,
}));
vi.mock("@/lib/pipeline-health", () => ({ getPipelineHealth: vi.fn() }));
vi.mock("./crew", () => ({ getCrewStatus: vi.fn() }));
vi.mock("./run-store", () => ({ startAgentRun: mocks.startAgentRun }));
vi.mock("./state-lane-scheduler", () => ({
  startStateLaneRun: mocks.startStateLaneRun,
  scheduleDueStateLaneRuns: mocks.scheduleDueStateLaneRuns,
  STATE_LANE_STEPS: [{ key: "enhance", agent: "atlas", title: "Enhance" }],
}));

import { parseCrewCommand } from "./crew-commands";
import { answerCrewCommand, executeCrewWrite } from "./crew-execute";

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.getPipelineControl.mockResolvedValue({ enabled: true });
});

describe("answerCrewCommand", () => {
  it("never acts on a write; it returns a confirmation proposal", async () => {
    const reply = await answerCrewCommand(parseCrewCommand("Atlas, run Georgia"), "Atlas, run Georgia");
    expect(reply.confirm).toEqual({
      summary: "Atlas will run the full pipeline for Georgia.",
      commandText: "Atlas, run Georgia",
    });
    expect(mocks.startStateLaneRun).not.toHaveBeenCalled();
    expect(mocks.setPipelineEnabled).not.toHaveBeenCalled();
  });

  it("lists what it can do for unknown input", async () => {
    const reply = await answerCrewCommand(parseCrewCommand("sing a song"), "sing a song");
    expect(reply.lines[0]).toBe("I didn't catch that.");
    expect(reply.lines).toContain("• Atlas, run Georgia");
  });
});

describe("executeCrewWrite", () => {
  it("starts a state lane through the run ledger", async () => {
    mocks.startStateLaneRun.mockResolvedValue({ run: { id: 501 }, reused: false });
    const reply = await executeCrewWrite(parseCrewCommand("Atlas, run Georgia"), "owner");
    expect(mocks.startStateLaneRun).toHaveBeenCalledWith(expect.objectContaining({ stateCode: "GA", triggeredBy: "owner" }));
    expect(reply.lines[0]).toBe("Queued Georgia (run #501).");
    expect(reply.runId).toBe(501);
    expect(reply.links).toContainEqual({ label: "Track run #501", href: "/admin/atlas/runs/501" });
  });

  it("runs only the addressed worker's steps", async () => {
    mocks.startAgentRun.mockResolvedValue({ run: { id: 77 } });
    await executeCrewWrite(parseCrewCommand("Magellan, run Texas"), "owner");
    const input = mocks.startAgentRun.mock.calls[0][0];
    expect(input.agent).toBe("magellan");
    expect(input.stateCode).toBe("TX");
    expect(input.steps.map((step: { key: string }) => step.key)).toEqual(["discover", "fetch"]);
  });

  it("queues only the selected bank's eligible verified fees with an auditable run ID", async () => {
    mocks.sql.mockResolvedValue([{ institution_name: "Pinnacle Bank" }]);
    mocks.startAgentRun.mockResolvedValue({ run: { id: 847 }, reused: false });
    const reply = await executeCrewWrite(parseCrewCommand("Hamilton, publish institution 47"), "owner");
    expect(mocks.startAgentRun).toHaveBeenCalledTimes(1);
    expect(mocks.startAgentRun).toHaveBeenCalledWith(expect.objectContaining({
      agent: "gutenberg",
      kind: "manual_repair",
      params: { source: "admin.crew_command", scope: "institution", institution_id: 47 },
      idempotencyKey: "crew:gutenberg:institution:47:publish",
      steps: [{ key: "publish", agent: "gutenberg", title: "Publish verified fees" }],
    }));
    expect(reply.runId).toBe(847);
    expect(reply.links).toContainEqual({ label: "Track run #847", href: "/admin/atlas/runs/847" });
  });

  it("reuses an active bank publish run rather than launching another", async () => {
    mocks.sql.mockResolvedValue([{ institution_name: "Pinnacle Bank" }]);
    mocks.startAgentRun.mockResolvedValue({ run: { id: 847 }, reused: true });
    const reply = await executeCrewWrite(parseCrewCommand("Hamilton, publish institution 47"), "owner");
    expect(reply.runId).toBe(847);
    expect(reply.runReused).toBe(true);
    expect(reply.lines[0]).toContain("reused");
  });

  it("never queues publication for an unknown institution", async () => {
    mocks.sql.mockResolvedValue([]);
    const reply = await executeCrewWrite(parseCrewCommand("Hamilton, publish institution 47"), "owner");
    expect(reply.lines[0]).toContain("not found");
    expect(reply.runId).toBeUndefined();
    expect(mocks.startAgentRun).not.toHaveBeenCalled();
  });

  it("leaves a paused pipeline paused while allowing its run to be queued", async () => {
    mocks.getPipelineControl.mockResolvedValue({ enabled: false });
    mocks.sql.mockResolvedValue([{ institution_name: "Pinnacle Bank" }]);
    mocks.startAgentRun.mockResolvedValue({ run: { id: 849 }, reused: false });
    const reply = await executeCrewWrite(parseCrewCommand("Hamilton, publish institution 47"), "owner");
    expect(reply.lines).toContain("Note: the pipeline is paused, so this waits until you resume.");
    expect(mocks.setPipelineEnabled).not.toHaveBeenCalled();
  });

  it("pauses the pipeline control", async () => {
    await executeCrewWrite(parseCrewCommand("pause"), "owner");
    expect(mocks.setPipelineEnabled).toHaveBeenCalledWith("owner", false, expect.any(String));
  });

  describe("retry after #1075 step 2: each side retries only the steps it owns", () => {
    // Newest first, as the query orders them: Hamilton's product failure is the newest of all.
    const failedSteps = [
      { id: 903, state_code: null, step_key: "hamilton-answer-eval", agent_name: "hamilton" },
      { id: 902, state_code: "TX", step_key: "publish", agent_name: "hamilton" },
      { id: 901, state_code: null, step_key: "briefing-refresh", agent_name: "hamilton" },
    ];
    // The mock applies the query's own filter to the values it binds.
    const queryFailed = () =>
      mocks.sql.mockImplementation(async (strings: TemplateStringsArray, names: string[], keys: string[], agent: string) => {
        const text = strings.join("$");
        expect(text).toContain("THEN 'gutenberg'");
        expect(text).toContain("WHEN s.agent_name = 'magellan' AND s.step_key LIKE 'registry-%' THEN 'hoovie'");
        expect(text).toContain("ELSE s.agent_name END) = $");
        const owner = (row: (typeof failedSteps)[number]) =>
          row.agent_name === "hamilton" && keys.includes(row.step_key)
            ? "gutenberg"
            : row.agent_name === "magellan" && row.step_key.startsWith("registry-") ? "hoovie" : row.agent_name;
        return failedSteps.filter((row) => names.includes(row.agent_name) && owner(row) === agent).slice(0, 1);
      });

    it("Gutenberg retries a pre-switch publish failure, never Hamilton's answer eval", async () => {
      queryFailed();
      mocks.startAgentRun.mockResolvedValue({ run: { id: 950 }, reused: false });
      await executeCrewWrite(parseCrewCommand("Gutenberg, retry failed"), "owner");
      expect(mocks.startAgentRun).toHaveBeenCalledWith(expect.objectContaining({
        agent: "gutenberg",
        steps: [{ key: "publish", agent: "gutenberg", title: "Retry publish" }],
      }));
    });

    it("Hamilton retries its own product failure, never an old publish failure", async () => {
      failedSteps.unshift({ id: 904, state_code: "GA", step_key: "publish", agent_name: "hamilton" });
      queryFailed();
      mocks.startAgentRun.mockResolvedValue({ run: { id: 951 }, reused: false });
      await executeCrewWrite(parseCrewCommand("Hamilton, retry failed"), "owner");
      expect(mocks.startAgentRun).toHaveBeenCalledWith(expect.objectContaining({
        agent: "hamilton",
        steps: [{ key: "hamilton-answer-eval", agent: "hamilton", title: "Retry hamilton-answer-eval" }],
      }));
      failedSteps.shift();
    });

    it("Magellan skips a registry failure written under its name before #1865; Hoovie retries it", async () => {
      failedSteps.unshift(
        { id: 906, state_code: null, step_key: "registry-fdic-financials", agent_name: "magellan" },
        { id: 905, state_code: "OH", step_key: "fetch", agent_name: "magellan" },
      );
      queryFailed();
      mocks.startAgentRun.mockResolvedValue({ run: { id: 952 }, reused: false });
      await executeCrewWrite(parseCrewCommand("Magellan, retry failed"), "owner");
      expect(mocks.startAgentRun).toHaveBeenLastCalledWith(expect.objectContaining({
        agent: "magellan",
        steps: [{ key: "fetch", agent: "magellan", title: "Retry fetch" }],
      }));
      // Hoovie has no command-bar name, so its retry is exercised through the parsed command shape.
      await executeCrewWrite({ kind: "retry", agent: "hoovie" }, "owner");
      expect(mocks.startAgentRun).toHaveBeenLastCalledWith(expect.objectContaining({
        agent: "hoovie",
        steps: [{ key: "registry-fdic-financials", agent: "hoovie", title: "Retry registry-fdic-financials" }],
      }));
      failedSteps.splice(0, 2);
    });
  });

  it("says so when there is nothing to retry", async () => {
    mocks.sql.mockResolvedValue([]);
    const reply = await executeCrewWrite(parseCrewCommand("Knox, retry failed"), "owner");
    expect(reply.lines[0]).toBe("I don't have a failed job to retry.");
    expect(mocks.startAgentRun).not.toHaveBeenCalled();
  });
});
