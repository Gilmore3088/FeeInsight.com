import { beforeEach, describe, expect, it, vi } from "vitest";

const sqlCalls: Array<{ values: unknown[] }> = [];
let queuedRows: unknown[][] = [];

const sqlMock = vi.fn((_strings: TemplateStringsArray, ...values: unknown[]) => {
  sqlCalls.push({ values });
  return Promise.resolve(queuedRows.shift() ?? []);
});

vi.mock("@/lib/data-store/connection", () => ({
  sql: sqlMock,
}));

describe("Hamilton artifact context store", () => {
  beforeEach(() => {
    sqlCalls.length = 0;
    queuedRows = [];
    sqlMock.mockClear();
  });

  it("does not query when no artifact lookup is available", async () => {
    const { getHamiltonArtifactInstitutionId } = await import("./artifact-context-store");

    await expect(
      getHamiltonArtifactInstitutionId({
        userId: 7,
        lookup: null,
      }),
    ).resolves.toBeNull();

    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("loads canonical saved analysis institution context for the current user", async () => {
    const { getHamiltonArtifactInstitutionId } = await import("./artifact-context-store");
    queuedRows = [[{ institution_id: "2945" }]];

    await expect(
      getHamiltonArtifactInstitutionId({
        userId: 7,
        lookup: { kind: "analysis", artifactId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" },
      }),
    ).resolves.toBe("2945");

    expect(sqlCalls[0].values).toEqual(["1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", 7]);
  });

  it("loads canonical saved scenario institution context for the current user", async () => {
    const { getHamiltonArtifactInstitutionId } = await import("./artifact-context-store");
    queuedRows = [[{ institution_id: 8109 }]];

    await expect(
      getHamiltonArtifactInstitutionId({
        userId: 7,
        lookup: { kind: "scenario", artifactId: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e" },
      }),
    ).resolves.toBe("8109");

    expect(sqlCalls[0].values).toEqual(["2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e", 7]);
  });

  it("loads canonical saved report institution context for the current user", async () => {
    const { getHamiltonArtifactInstitutionId } = await import("./artifact-context-store");
    queuedRows = [[{ institution_id: "8109" }]];

    await expect(
      getHamiltonArtifactInstitutionId({
        userId: 7,
        lookup: { kind: "report", artifactId: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f" },
      }),
    ).resolves.toBe("8109");

    expect(sqlCalls[0].values).toEqual(["3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f", 7]);
  });

  it("rejects saved artifact profile-name slugs as institution context", async () => {
    const { getHamiltonArtifactInstitutionId } = await import("./artifact-context-store");
    queuedRows = [[{ institution_id: "first-national-bank" }]];

    await expect(
      getHamiltonArtifactInstitutionId({
        userId: 7,
        lookup: { kind: "analysis", artifactId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" },
      }),
    ).resolves.toBeNull();
  });

  it.each(["analysis", "scenario", "report"] as const)(
    "does not send a malformed %s id to the uuid column",
    async (kind) => {
      const { getHamiltonArtifactInstitutionId } = await import("./artifact-context-store");

      await expect(
        getHamiltonArtifactInstitutionId({ userId: 7, lookup: { kind, artifactId: "not-a-uuid" } }),
      ).resolves.toBeNull();

      expect(sqlMock).not.toHaveBeenCalled();
    },
  );
});
