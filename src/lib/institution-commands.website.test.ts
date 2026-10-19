import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./auth", () => ({ requireAuth: vi.fn(async () => ({ username: "james" })) }));
vi.mock("./agents/run-store", () => ({ startAgentRun: vi.fn() }));
vi.mock("./data-store/connection", () => ({ sql: mocks.sql, withTransaction: vi.fn() }));

import { setInstitutionWebsiteUrl } from "./institution-commands";

describe("setting an institution's website (#1754)", () => {
  beforeEach(() => {
    mocks.sql.mockReset();
    mocks.sql.mockResolvedValue([{ state_code: "ND" }]);
  });

  it("stores the homepage without a trailing slash", async () => {
    await expect(setInstitutionWebsiteUrl(256, " https://www.bankwithchoice.com/ ")).resolves.toEqual({ success: true });
    const [strings, url, id] = mocks.sql.mock.calls[0];
    expect((strings as TemplateStringsArray).join("?")).toContain("SET website_url = ?");
    expect(url).toBe("https://www.bankwithchoice.com");
    expect(id).toBe(256);
  });

  it("refuses Choice Financial's stored value, whose host parses as \"http\"", async () => {
    const result = await setInstitutionWebsiteUrl(256, "https://HTTP://WWW.BANKWITHCHOICE.COM");
    expect(result.success).toBe(false);
    expect(result.error).toContain("full domain name");
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("refuses a non-web scheme and reports a missing institution", async () => {
    expect((await setInstitutionWebsiteUrl(256, "ftp://www.example.com")).success).toBe(false);
    mocks.sql.mockResolvedValue([]);
    expect(await setInstitutionWebsiteUrl(999999, "https://www.example.com")).toEqual({ success: false, error: "Institution not found" });
  });
});
