import { describe, expect, it } from "vitest";
import { matchesConfiguredCronSecret } from "./cron-secret";

describe("matchesConfiguredCronSecret", () => {
  it("matches a dedicated report cron secret", () => {
    expect(matchesConfiguredCronSecret("secret", {
      REPORT_CRON_SECRET: "secret",
    })).toBe(true);
  });

  it("matches a bearer cron secret", () => {
    expect(matchesConfiguredCronSecret("Bearer secret", {
      CRON_SECRET: "secret",
    })).toBe(true);
  });

  it("normalizes deployment-injected line endings", () => {
    expect(matchesConfiguredCronSecret("secret", {
      REPORT_CRON_SECRET: "secret\n",
    })).toBe(true);
  });

  it("never accepts the page-refresh token as a cron secret", () => {
    const environment = { CRON_SECRET: "cron", BFI_REVALIDATE_TOKEN: "refresh" } as Parameters<typeof matchesConfiguredCronSecret>[1];
    expect(matchesConfiguredCronSecret("refresh", environment)).toBe(false);
    expect(matchesConfiguredCronSecret("Bearer refresh", environment)).toBe(false);
  });

  it("rejects missing and incorrect credentials", () => {
    expect(matchesConfiguredCronSecret(null, { REPORT_CRON_SECRET: "secret" })).toBe(false);
    expect(matchesConfiguredCronSecret("wrong", { REPORT_CRON_SECRET: "secret" })).toBe(false);
  });
});
