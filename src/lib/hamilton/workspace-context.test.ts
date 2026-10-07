import { beforeEach, describe, expect, it, vi } from "vitest";

const sqlCalls: Array<{ values: unknown[] }> = [];
let queuedRows: unknown[][] = [];

const sqlMock = vi.fn((_strings: TemplateStringsArray, ...values: unknown[]) => {
  sqlCalls.push({ values });
  return Promise.resolve(queuedRows.shift() ?? []);
});

const parseInstitutionIdMock = vi.fn((value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
});

const getHamiltonInstitutionContextMock = vi.fn();

vi.mock("@/lib/data-store/connection", () => ({
  sql: sqlMock,
}));

vi.mock("@/lib/hamilton/institution-context", () => ({
  parseInstitutionId: parseInstitutionIdMock,
  getHamiltonInstitutionContext: getHamiltonInstitutionContextMock,
}));

describe("Hamilton workspace context", () => {
  beforeEach(() => {
    sqlCalls.length = 0;
    queuedRows = [];
    sqlMock.mockClear();
    parseInstitutionIdMock.mockClear();
    getHamiltonInstitutionContextMock.mockReset();
  });

  it("rejects invalid URL institution IDs without touching workspace storage", async () => {
    const { resolveHamiltonInstitutionContext } = await import("./workspace-context");

    const result = await resolveHamiltonInstitutionContext({
      userId: 7,
      instId: "not-an-id",
      intent: "analyze",
    });

    expect(result).toEqual({ institution: null, error: "Invalid institution ID", source: "none" });
    expect(getHamiltonInstitutionContextMock).not.toHaveBeenCalled();
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("persists a valid URL-selected institution after validation", async () => {
    const { resolveHamiltonInstitutionContext } = await import("./workspace-context");
    const institution = { id: 2945, name: "Hamilton Bank" };
    getHamiltonInstitutionContextMock.mockResolvedValue({ institution, error: null });

    const result = await resolveHamiltonInstitutionContext({
      userId: 7,
      instId: "2945",
      intent: "competitive-brief",
    });

    expect(result).toEqual({ institution, error: null, source: "url", isWorkspaceBank: true });
    expect(getHamiltonInstitutionContextMock).toHaveBeenCalledWith(2945);
    // One lookup for a saved bank (none), then the save.
    expect(sqlMock).toHaveBeenCalledTimes(2);
    expect(sqlCalls[1].values).toEqual([7, 2945, "url", "competitive-brief"]);
  });

  it("does not replace a saved bank when browsing another one", async () => {
    const { resolveHamiltonInstitutionContext } = await import("./workspace-context");
    const institution = { id: 2945, name: "Hamilton Bank" };
    getHamiltonInstitutionContextMock.mockResolvedValue({ institution, error: null });
    queuedRows = [[{ user_id: 7, selected_institution_id: 8109, selected_source: "manual", last_intent: null, updated_at: "2026-10-01" }]];

    const result = await resolveHamiltonInstitutionContext({ userId: 7, instId: "2945" });

    expect(result.institution).toBe(institution);
    expect(result.isWorkspaceBank).toBe(false);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it("saves the browsed bank when the user asks to make it theirs", async () => {
    const { resolveHamiltonInstitutionContext } = await import("./workspace-context");
    const institution = { id: 2945, name: "Hamilton Bank" };
    getHamiltonInstitutionContextMock.mockResolvedValue({ institution, error: null });

    await resolveHamiltonInstitutionContext({ userId: 7, instId: "2945", makeDefault: true });

    expect(sqlMock).toHaveBeenCalledTimes(1);
    expect(sqlCalls[0].values).toEqual([7, 2945, "url", null]);
  });

  it("returns saved-artifact source without persisting artifact fallback as workspace context", async () => {
    const { resolveHamiltonInstitutionContext } = await import("./workspace-context");
    const institution = { id: 2945, name: "Saved Artifact Bank" };
    getHamiltonInstitutionContextMock.mockResolvedValue({ institution, error: null });

    const result = await resolveHamiltonInstitutionContext({
      userId: 7,
      instId: "2945",
      intent: "analyze",
      persistUrlSelection: false,
      transientSource: "artifact",
    });

    expect(result).toEqual({ institution, error: null, source: "artifact" });
    expect(getHamiltonInstitutionContextMock).toHaveBeenCalledWith(2945);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("falls back to the stored workspace institution when URL context is absent", async () => {
    const { resolveHamiltonInstitutionContext } = await import("./workspace-context");
    const institution = { id: 8109, name: "Stored Credit Union" };
    queuedRows = [
      [
        {
          user_id: 7,
          selected_institution_id: 8109,
          selected_source: "manual",
          last_intent: "analyze",
          updated_at: "2026-08-15T00:00:00.000Z",
        },
      ],
    ];
    getHamiltonInstitutionContextMock.mockResolvedValue({ institution, error: null });

    const result = await resolveHamiltonInstitutionContext({
      userId: 7,
      instId: null,
      intent: "reports",
    });

    expect(result).toEqual({ institution, error: null, source: "manual" });
    expect(getHamiltonInstitutionContextMock).toHaveBeenCalledWith(8109);
  });
});
