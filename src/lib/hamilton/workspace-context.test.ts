import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  parseInstitutionId: vi.fn(),
  getInstitution: vi.fn(),
}));

vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql }));
vi.mock("@/lib/hamilton/institution-context", () => ({
  parseInstitutionId: mocks.parseInstitutionId,
  getHamiltonInstitutionContext: mocks.getInstitution,
}));

import { resolveHamiltonInstitutionContext } from "./workspace-context";

const subject = { id: 2945, name: "Research Bank" };
const savedBank = { id: 8109, name: "Synthetic Home Credit Union" };
const savedRow = {
  user_id: 7,
  selected_institution_id: savedBank.id,
  selected_source: "manual",
  last_intent: "analyze",
  updated_at: "2026-10-01T00:00:00.000Z",
};

function expectOnlyRead() {
  expect(mocks.sql).toHaveBeenCalledTimes(1);
  expect(mocks.sql.mock.calls[0][0].join(" ")).toMatch(/SELECT user_id/);
  expect(mocks.sql.mock.calls[0].slice(1)).toEqual([7]);
}

function expectExplicitWrite() {
  expect(mocks.sql).toHaveBeenCalledTimes(1);
  expect(mocks.sql.mock.calls[0][0].join(" ")).toMatch(/INSERT INTO hamilton_workspace_contexts/);
}

describe("Hamilton workspace context", () => {
  beforeEach(() => {
    mocks.sql.mockReset().mockResolvedValue([]);
    mocks.getInstitution.mockReset().mockResolvedValue({ institution: subject, error: null });
    mocks.parseInstitutionId.mockReset().mockImplementation((value: string | number | null | undefined) => {
      if (value === null || value === undefined || value === "") return null;
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    });
  });

  it("rejects invalid subject IDs before institution or workspace reads", async () => {
    const result = await resolveHamiltonInstitutionContext({ userId: 7, instId: "not-an-id" });
    expect(result).toEqual({ institution: null, error: "Invalid institution ID", source: "none" });
    expect(mocks.getInstitution).not.toHaveBeenCalled();
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("does not save a subject that could not be resolved, even on explicit selection", async () => {
    mocks.getInstitution.mockResolvedValue({ institution: null, error: "Institution not found" });
    const result = await resolveHamiltonInstitutionContext({ userId: 7, instId: 2945, makeDefault: true });
    expect(result).toEqual({ institution: null, error: "Institution not found", source: "none" });
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("does not turn a first browsed institution into the saved workspace", async () => {
    const result = await resolveHamiltonInstitutionContext({ userId: 7, instId: "2945" });
    expect(result).toEqual({ institution: subject, error: null, source: "url", workspaceInstitutionId: null, isWorkspaceBank: false });
    expect(mocks.getInstitution).toHaveBeenCalledWith(2945);
    expectOnlyRead();
  });

  it("treats persistUrlSelection=true as permission, not an instruction to save", async () => {
    const result = await resolveHamiltonInstitutionContext({ userId: 7, instId: 2945, persistUrlSelection: true });
    expect(result.isWorkspaceBank).toBe(false);
    expect(result.workspaceInstitutionId).toBe(null);
    expectOnlyRead();
  });

  it("keeps a different saved workspace while researching the requested subject", async () => {
    mocks.sql.mockResolvedValue([savedRow]);
    const result = await resolveHamiltonInstitutionContext({ userId: 7, instId: 2945 });
    expect(result.institution).toBe(subject);
    expect(result.workspaceInstitutionId).toBe(savedBank.id);
    expect(result.isWorkspaceBank).toBe(false);
    expectOnlyRead();
  });

  it("recognizes a matching saved preference without writing it again", async () => {
    mocks.sql.mockResolvedValue([{ ...savedRow, selected_institution_id: subject.id }]);
    const result = await resolveHamiltonInstitutionContext({ userId: 7, instId: 2945 });
    expect(result.workspaceInstitutionId).toBe(subject.id);
    expect(result.isWorkspaceBank).toBe(true);
    expectOnlyRead();
  });

  it("does not save when makeDefault is explicitly false", async () => {
    const result = await resolveHamiltonInstitutionContext({ userId: 7, instId: 2945, makeDefault: false });
    expect(result.isWorkspaceBank).toBe(false);
    expectOnlyRead();
  });

  it("saves only an explicit validated selection and records its intent", async () => {
    const result = await resolveHamiltonInstitutionContext({ userId: 7, instId: "2945", makeDefault: true, intent: " competitive-brief " });
    expectExplicitWrite();
    expect(mocks.sql.mock.calls[0].slice(1)).toEqual([7, 2945, "url", "competitive-brief"]);
    expect(result).toEqual({ institution: subject, error: null, source: "url", workspaceInstitutionId: 2945, isWorkspaceBank: true });
  });

  it("allows an explicit selection with the legacy allow-write flag", async () => {
    const result = await resolveHamiltonInstitutionContext({ userId: 7, instId: 2945, makeDefault: true, persistUrlSelection: true });
    expectExplicitWrite();
    expect(result.isWorkspaceBank).toBe(true);
  });

  it("lets the no-write flag override even an explicit selection", async () => {
    mocks.sql.mockResolvedValue([savedRow]);
    const result = await resolveHamiltonInstitutionContext({ userId: 7, instId: 2945, makeDefault: true, persistUrlSelection: false });
    expect(result.workspaceInstitutionId).toBe(savedBank.id);
    expect(result.isWorkspaceBank).toBe(false);
    expectOnlyRead();
  });

  it("retains both subject and saved preference for transient Ask requests", async () => {
    mocks.sql.mockResolvedValue([savedRow]);
    const result = await resolveHamiltonInstitutionContext({ userId: 7, instId: "2945", persistUrlSelection: false });
    expect(result).toEqual({ institution: subject, error: null, source: "url", workspaceInstitutionId: savedBank.id, isWorkspaceBank: false });
    expectOnlyRead();
  });

  it("opens a saved artifact without adopting its institution", async () => {
    mocks.sql.mockResolvedValue([savedRow]);
    const result = await resolveHamiltonInstitutionContext({ userId: 7, instId: 2945, persistUrlSelection: false, transientSource: "artifact" });
    expect(result).toEqual({ institution: subject, error: null, source: "artifact", workspaceInstitutionId: savedBank.id, isWorkspaceBank: false });
    expectOnlyRead();
  });

  it("recognizes a matching artifact subject without saving it", async () => {
    mocks.sql.mockResolvedValue([{ ...savedRow, selected_institution_id: subject.id }]);
    const result = await resolveHamiltonInstitutionContext({ userId: 7, instId: 2945, persistUrlSelection: false, transientSource: "artifact" });
    expect(result.source).toBe("artifact");
    expect(result.isWorkspaceBank).toBe(true);
    expectOnlyRead();
  });

  it("does not adopt an artifact when no workspace has been selected", async () => {
    const result = await resolveHamiltonInstitutionContext({ userId: 7, instId: 2945, persistUrlSelection: false, transientSource: "artifact" });
    expect(result.workspaceInstitutionId).toBe(null);
    expect(result.isWorkspaceBank).toBe(false);
    expect(result.source).toBe("artifact");
    expectOnlyRead();
  });

  it("keeps transient selection-source labels while reading the saved preference", async () => {
    mocks.sql.mockResolvedValue([savedRow]);
    const result = await resolveHamiltonInstitutionContext({ userId: 7, instId: 2945, persistUrlSelection: false, transientSource: "watchlist" });
    expect(result.source).toBe("watchlist");
    expect(result.workspaceInstitutionId).toBe(savedBank.id);
    expectOnlyRead();
  });

  it("does not turn a failed workspace read into permission to save the URL subject", async () => {
    mocks.sql.mockRejectedValue(new Error("synthetic read failure"));
    const result = await resolveHamiltonInstitutionContext({ userId: 7, instId: 2945 });
    expect(result.institution).toBe(subject);
    expect(result.error).toBe("Your saved workspace selection could not be loaded.");
    expect(result.workspaceInstitutionId).toBeUndefined();
    expect(result.isWorkspaceBank).toBeUndefined();
    expectOnlyRead();
  });

  it("keeps a transient research subject usable but reports an unknown saved preference", async () => {
    mocks.sql.mockRejectedValue(new Error("synthetic read failure"));
    const result = await resolveHamiltonInstitutionContext({ userId: 7, instId: 2945, persistUrlSelection: false, transientSource: "artifact" });
    expect(result.institution).toBe(subject);
    expect(result.source).toBe("artifact");
    expect(result.error).toBe("Your saved workspace selection could not be loaded.");
    expect(result.workspaceInstitutionId).toBeUndefined();
    expectOnlyRead();
  });

  it("never reports a failed explicit save as a successful workspace selection", async () => {
    mocks.sql.mockRejectedValue(new Error("synthetic write failure"));
    const result = await resolveHamiltonInstitutionContext({ userId: 7, instId: 2945, makeDefault: true });
    expect(result.institution).toBe(subject);
    expect(result.error).toBe("Your workspace selection could not be saved. Please try again.");
    expect(result.workspaceInstitutionId).toBeUndefined();
    expect(result.isWorkspaceBank).toBeUndefined();
    expectExplicitWrite();
  });

  it("falls back to a saved workspace only when no explicit subject was supplied", async () => {
    mocks.sql.mockResolvedValue([savedRow]);
    mocks.getInstitution.mockResolvedValue({ institution: savedBank, error: null });
    const result = await resolveHamiltonInstitutionContext({ userId: 7, instId: null, intent: "reports" });
    expect(result).toEqual({ institution: savedBank, error: null, source: "manual", workspaceInstitutionId: savedBank.id, isWorkspaceBank: true });
    expect(mocks.getInstitution).toHaveBeenCalledWith(savedBank.id);
    expectOnlyRead();
  });

  it("represents the known absence of a subject and saved preference explicitly", async () => {
    const result = await resolveHamiltonInstitutionContext({ userId: 7 });
    expect(result).toEqual({ institution: null, error: null, source: "none", workspaceInstitutionId: null, isWorkspaceBank: false });
    expect(mocks.getInstitution).not.toHaveBeenCalled();
    expectOnlyRead();
  });

  it("distinguishes failed fallback storage from having no saved preference", async () => {
    mocks.sql.mockRejectedValue(new Error("synthetic read failure"));
    const result = await resolveHamiltonInstitutionContext({ userId: 7 });
    expect(result).toEqual({ institution: null, error: "Your saved workspace selection could not be loaded.", source: "none" });
    expect(mocks.getInstitution).not.toHaveBeenCalled();
    expectOnlyRead();
  });

  it("retains a stale saved ID without claiming an unresolved institution is selected", async () => {
    mocks.sql.mockResolvedValue([savedRow]);
    mocks.getInstitution.mockResolvedValue({ institution: null, error: "Institution not found" });
    const result = await resolveHamiltonInstitutionContext({ userId: 7, instId: "" });
    expect(result).toEqual({ institution: null, error: "Institution not found", source: "none", workspaceInstitutionId: savedBank.id, isWorkspaceBank: false });
    expectOnlyRead();
  });

  it("normalizes persisted numeric IDs and legacy source values", async () => {
    mocks.sql.mockResolvedValue([{ ...savedRow, selected_institution_id: String(subject.id), selected_source: "artifact" }]);
    const result = await resolveHamiltonInstitutionContext({ userId: 7 });
    expect(result.source).toBe("manual");
    expect(result.workspaceInstitutionId).toBe(subject.id);
    expect(result.isWorkspaceBank).toBe(true);
    expectOnlyRead();
  });

  it("keeps the explicit preference across a sequence of research and artifact visits", async () => {
    let savedId: number | null = null;
    let writes = 0;
    mocks.sql.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      if (/INSERT INTO/.test(strings.join(" "))) {
        writes += 1;
        savedId = Number(values[1]);
        return Promise.resolve([]);
      }
      return Promise.resolve(savedId === null ? [] : [{ ...savedRow, selected_institution_id: savedId }]);
    });
    mocks.getInstitution.mockImplementation((id: number) => Promise.resolve({
      institution: id === savedBank.id ? savedBank : subject,
      error: null,
    }));
    await resolveHamiltonInstitutionContext({ userId: 7, instId: subject.id });
    expect(savedId).toBe(null);
    expect(writes).toBe(0);
    await resolveHamiltonInstitutionContext({ userId: 7, instId: savedBank.id, makeDefault: true });
    await resolveHamiltonInstitutionContext({ userId: 7, instId: subject.id });
    await resolveHamiltonInstitutionContext({ userId: 7, instId: subject.id, persistUrlSelection: false, transientSource: "artifact" });
    const result = await resolveHamiltonInstitutionContext({ userId: 7 });
    expect(writes).toBe(1);
    expect(savedId).toBe(savedBank.id);
    expect(result.institution).toBe(savedBank);
    expect(result.workspaceInstitutionId).toBe(savedBank.id);
  });
});
