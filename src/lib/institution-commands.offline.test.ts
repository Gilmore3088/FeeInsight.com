import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ tx: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./auth", () => ({ requireAuth: vi.fn(async () => ({ username: "james" })) }));
vi.mock("./agents/run-store", () => ({ startAgentRun: vi.fn() }));
vi.mock("./data-store/connection", () => ({
  sql: vi.fn(),
  withTransaction: vi.fn(async (fn: (tx: typeof mocks.tx) => unknown) => fn(mocks.tx)),
}));

import { markInstitutionOfflineCommand, setInstitutionFeeUrl } from "./institution-commands";

const text = (call: unknown[]) => (call[0] as TemplateStringsArray).join("?");

describe("marking an institution offline (#1884)", () => {
  beforeEach(() => {
    mocks.tx.mockReset();
  });

  it("clears the fee link and the profile's remembered address in one transaction", async () => {
    mocks.tx.mockResolvedValueOnce([{ state_code: "TX" }]).mockResolvedValueOnce([]);
    await expect(markInstitutionOfflineCommand(42)).resolves.toEqual({ success: true });

    expect(mocks.tx).toHaveBeenCalledTimes(2);
    const [inst, profile] = mocks.tx.mock.calls;
    expect(text(inst)).toContain("UPDATE institution_sources");
    expect(text(inst)).toContain("fee_schedule_url = NULL");
    expect(text(inst)).toContain("document_type = 'offline'");

    // Magellan fetches profile.canonical_source_url and skips only source_kind = 'offline'.
    expect(text(profile)).toContain("UPDATE institution_source_profiles");
    expect(text(profile)).toContain("canonical_source_url = NULL");
    expect(text(profile)).toContain("source_kind = 'offline'");
    // A person's word wins over a locked correction, as with a person's fee link (#1881).
    expect(text(profile)).not.toContain("locked_by_correction");
    expect(profile[1]).toBe(42);
  });

  it("touches no profile when the institution does not exist", async () => {
    mocks.tx.mockResolvedValueOnce([]);
    await expect(markInstitutionOfflineCommand(999999)).resolves.toEqual({
      success: false,
      error: "Institution not found",
    });
    expect(mocks.tx).toHaveBeenCalledTimes(1);
  });

  it("refuses an invalid id without writing", async () => {
    expect((await markInstitutionOfflineCommand(0)).success).toBe(false);
    expect(mocks.tx).not.toHaveBeenCalled();
  });
});

describe("setting a fee link on a bank marked offline (#1884)", () => {
  beforeEach(() => {
    mocks.tx.mockReset();
  });

  it("brings the profile back from offline so Magellan fetches the new link", async () => {
    mocks.tx.mockResolvedValueOnce([{ state_code: "TX" }]).mockResolvedValueOnce([]);
    await expect(setInstitutionFeeUrl(42, "https://www.example.com/fees.pdf")).resolves.toEqual({ success: true });

    const [, profile] = mocks.tx.mock.calls;
    expect(text(profile)).toContain("canonical_source_url = ?");
    expect(text(profile)).toContain("CASE WHEN source_kind = 'offline' THEN 'unknown' ELSE source_kind END");
    expect(text(profile)).not.toContain("read_strategy");
    expect(profile[1]).toBe("https://www.example.com/fees.pdf");
  });
});
