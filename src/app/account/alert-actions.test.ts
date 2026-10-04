import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createUserWithSession: vi.fn(),
  addAlertSubscription: vi.fn(),
  replaceAlertSubscription: vi.fn(),
  removeAlertSubscription: vi.fn(),
  institutionRows: [{ "?column?": 1 }] as unknown[],
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  createUserWithSession: mocks.createUserWithSession,
}));
vi.mock("@/lib/data-store/connection", () => ({ sql: () => Promise.resolve(mocks.institutionRows) }));
vi.mock("@/lib/data-store/alerts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data-store/alerts")>("@/lib/data-store/alerts");
  return {
    normalizeAlertCategories: actual.normalizeAlertCategories,
    addAlertSubscription: mocks.addAlertSubscription,
    replaceAlertSubscription: mocks.replaceAlertSubscription,
    removeAlertSubscription: mocks.removeAlertSubscription,
  };
});

describe("alert actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.institutionRows = [{ "?column?": 1 }];
    mocks.getCurrentUser.mockResolvedValue({ id: 7 });
    mocks.addAlertSubscription.mockResolvedValue({ id: 1, fee_categories: ["overdraft"] });
    mocks.replaceAlertSubscription.mockResolvedValue({ id: 1, fee_categories: null });
  });

  it("saves the focused fee for a signed-in reader", async () => {
    const { saveInstitutionAlert } = await import("./alert-actions");
    const result = await saveInstitutionAlert({ institutionId: 3, feeCategory: "overdraft" });
    expect(result).toEqual({ ok: true, feeCategories: ["overdraft"] });
    expect(mocks.addAlertSubscription).toHaveBeenCalledWith(7, 3, ["overdraft"]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/account");
  });

  it("replaces the list when following every fee", async () => {
    const { saveInstitutionAlert } = await import("./alert-actions");
    await saveInstitutionAlert({ institutionId: 3, feeCategory: "overdraft", allFees: true });
    expect(mocks.replaceAlertSubscription).toHaveBeenCalledWith(7, 3, null);
  });

  it("refuses signed-out saves, unknown fees and missing institutions", async () => {
    const { saveInstitutionAlert } = await import("./alert-actions");
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    expect(await saveInstitutionAlert({ institutionId: 3 })).toMatchObject({ ok: false });
    expect(await saveInstitutionAlert({ institutionId: 3, feeCategory: "made_up" })).toMatchObject({ ok: false });
    mocks.institutionRows = [];
    expect(await saveInstitutionAlert({ institutionId: 999 })).toMatchObject({ ok: false, error: "Institution not found." });
    expect(mocks.addAlertSubscription).not.toHaveBeenCalled();
  });

  it("creates a free account and saves in one step", async () => {
    mocks.createUserWithSession.mockResolvedValue({ ok: true, userId: 42 });
    const { registerConsumerAndSaveAlert } = await import("./alert-actions");
    const result = await registerConsumerAndSaveAlert({
      email: " New@Reader.com ",
      password: "password1",
      institutionId: 3,
      feeCategory: "overdraft",
    });
    expect(result).toEqual({ ok: true, feeCategories: ["overdraft"] });
    expect(mocks.createUserWithSession).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@reader.com", displayName: "new" }),
    );
    expect(mocks.addAlertSubscription).toHaveBeenCalledWith(42, 3, ["overdraft"]);
  });

  it("sends an existing account to sign in, back to the same fee", async () => {
    mocks.createUserWithSession.mockResolvedValue({ ok: false, code: "duplicate", message: "dup" });
    const { registerConsumerAndSaveAlert } = await import("./alert-actions");
    const result = await registerConsumerAndSaveAlert({
      email: "a@b.com",
      password: "password1",
      institutionId: 3,
      feeCategory: "overdraft",
    });
    expect(result).toMatchObject({ ok: false, loginHref: "/login?from=%2Finstitution%2F3%3Ffee%3Doverdraft" });
  });

  it("drops honeypot submissions and weak input without creating anything", async () => {
    const { registerConsumerAndSaveAlert } = await import("./alert-actions");
    expect(
      await registerConsumerAndSaveAlert({ email: "a@b.com", password: "password1", institutionId: 3, website: "x" }),
    ).toMatchObject({ ok: false });
    expect(await registerConsumerAndSaveAlert({ email: "a@b.com", password: "short", institutionId: 3 })).toMatchObject({
      ok: false,
    });
    expect(mocks.createUserWithSession).not.toHaveBeenCalled();
  });
});
