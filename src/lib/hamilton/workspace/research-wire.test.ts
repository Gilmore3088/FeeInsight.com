import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: Object.assign(vi.fn(), { unsafe: vi.fn((text: string) => text) }),
}));

vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql }));

import { CONSUMER_LAW_PG } from "@/lib/data-store/regulatory-watch";
import { loadWire } from "./research";

type Call = { text: string; values: unknown[] };

function calls(): Call[] {
  return mocks.sql.mock.calls.map((c) => ({ text: (c[0] as TemplateStringsArray).join("?"), values: c.slice(1) }));
}

const enforcementCall = () => calls().find((c) => c.text.includes("FROM institution_enforcement_actions"));

describe("loadWire enforcement read (#1254)", () => {
  const now = new Date("2026-10-14T12:00:00Z");

  beforeEach(() => {
    mocks.sql.mockReset();
    mocks.sql.mockImplementation((strings: TemplateStringsArray) =>
      Promise.resolve(
        strings.join("?").includes("FROM institution_enforcement_actions")
          ? [
              { agency: "OCC", party_name: "Example Bank, N.A.", party_state: "il", action_type: "Formal Agreement", subject: "Unfair or Deceptive Acts", start_date: "2026-03-01", document_url: null },
              { agency: "OCC", party_name: "Other Bank", party_state: "OH", action_type: "Formal Agreement", subject: "BSA/AML", start_date: "2026-02-01", document_url: null },
            ]
          : [],
      ),
    );
  });

  it("passes the bank's federal regulator, its state and the consumer-law test into the SQL", async () => {
    await loadWire("il", "Federal Reserve", now);
    const call = enforcementCall()!;
    expect(call.text).toContain("agency = ? OR upper(party_state) = ?");
    expect(call.text).toContain("subject ~* ?");
    expect(call.text).not.toContain("IN ('OCC', 'FRB')");
    expect(call.values).toEqual(["2023-10-14", "FRB", "IL", ["STATE_NY", "STATE_NC", "STATE_FL"], CONSUMER_LAW_PG]);
  });

  it("never reads a struck state's orders or posts (New York, North Carolina, Florida; 2026-10-18)", async () => {
    await loadWire("NY", "FDIC", now);
    expect(enforcementCall()!.text).toContain("agency <> ALL(?::text[])");
    const posts = calls().find((c) => c.text.includes("FROM reg_articles"))!;
    expect(posts.values).toEqual(expect.arrayContaining([["state:NY", "state:NC", "state:FL"]]));
  });

  it("passes no federal code for an FDIC or NCUA bank, so only its state's actions are read", async () => {
    await loadWire("IL", "FDIC", now);
    expect(enforcementCall()!.values.slice(1, 3)).toEqual([null, "IL"]);
  });

  it("skips the read when the bank has neither a loaded federal regulator nor a state", async () => {
    const wire = await loadWire(null, "NCUA", now);
    expect(enforcementCall()).toBeUndefined();
    expect(wire.actions).toEqual([]);
  });

  it("upper-cases party_state once and keeps only consumer-law subjects", async () => {
    const wire = await loadWire("IL", "OCC", now);
    expect(wire.actions).toHaveLength(1);
    expect(wire.actions[0]).toMatchObject({ agency: "OCC", party_state: "IL", party_name: "Example Bank, N.A." });
  });
});
