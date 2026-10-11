import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeCanonicalInstitutionId } from "./context-link";

const mocks = vi.hoisted(() => ({ institution: vi.fn(), sql: vi.fn() }));
vi.mock("@/lib/data-store", () => ({ getInstitutionById: mocks.institution }));
vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql }));

import { getHamiltonInstitutionContext, parseInstitutionId } from "./institution-context";
import { resolveHamiltonInstitutionContext } from "./workspace-context";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.sql.mockResolvedValue([{ user_id: 7, selected_institution_id: 2945, selected_source: "manual" }]);
  mocks.institution.mockImplementation(async (id: number) => ({
    id, institution_name: "Research institution", charter_type: "bank", city: null, state_code: null,
    asset_size: null, asset_size_tier: null, fed_district: null,
  }));
});

describe("shared canonical institution parser", () => {
  it.each([8109, "8109", " 8109 ", Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER)])("accepts canonical decimal ID %s consistently with links", (value) => {
    expect(parseInstitutionId(value)).toBe(Number(normalizeCanonicalInstitutionId(value)));
  });

  it.each([undefined, null, "", "   ", 0, "0", -1, "-1", 1.5, "1.5", NaN, Infinity,
    "08109", "0x1", "8.109e3", "8109.0", Number.MAX_SAFE_INTEGER + 1, "9007199254740992"])("rejects noncanonical or unsafe ID %s", (value) => {
    expect(parseInstitutionId(value)).toBeNull();
    expect(normalizeCanonicalInstitutionId(value)).toBeNull();
  });

  it.each(["08109", "0x1", "8.109e3", "9007199254740992"])("refuses explicit URL %s before any fallback or institution/storage read", async (value) => {
    expect(await resolveHamiltonInstitutionContext({ userId: 7, instId: value })).toEqual({
      institution: null, error: "Invalid institution ID", source: "none",
    });
    expect(mocks.institution).not.toHaveBeenCalled();
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("resolves a trimmed explicit decimal subject without adopting the saved research preference", async () => {
    const result = await resolveHamiltonInstitutionContext({ userId: 7, instId: " 8109 " });
    expect(result).toMatchObject({ institution: { id: 8109 }, source: "url", workspaceInstitutionId: 2945, isWorkspaceBank: false });
    expect(mocks.institution).toHaveBeenCalledWith(8109);
    expect(mocks.sql).toHaveBeenCalledTimes(1);
    expect(mocks.sql.mock.calls[0][0].join("")).toContain("SELECT user_id");
  });

  it("does not attempt a data lookup for an invalid direct institution context", async () => {
    expect(await getHamiltonInstitutionContext("08109")).toEqual({ institution: null, error: "Invalid institution ID" });
    expect(mocks.institution).not.toHaveBeenCalled();
  });
});
