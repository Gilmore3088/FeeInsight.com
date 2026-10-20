import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const TOKEN = "0123456789abcdef0123456789abcdef";
const original = process.env.HOSTED_REPORT_TOKENS;

function call(token: string) {
  return GET(new Request(`http://localhost/r/${token}/print`), {
    params: Promise.resolve({ token }),
  });
}

describe("GET /r/[token]/print", () => {
  afterEach(() => {
    if (original === undefined) delete process.env.HOSTED_REPORT_TOKENS;
    else process.env.HOSTED_REPORT_TOKENS = original;
  });

  it("returns 404 when HOSTED_REPORT_TOKENS is not set (fails closed)", async () => {
    delete process.env.HOSTED_REPORT_TOKENS;
    expect((await call(TOKEN)).status).toBe(404);
  });

  it("returns 404 for a token the config does not list", async () => {
    process.env.HOSTED_REPORT_TOKENS = JSON.stringify({
      [TOKEN]: {
        institution_id: 999999999,
        institution_name: "Example Bank",
        prepared_on: "2026-10-20",
        expires_on: "2099-01-01",
      },
    });
    expect((await call("ffffffffffffffffffffffffffffffff")).status).toBe(404);
  });

  it("serves the report for a token the config lists", async () => {
    process.env.HOSTED_REPORT_TOKENS = JSON.stringify({
      [TOKEN]: {
        institution_id: 1391,
        institution_name: "First Bank",
        prepared_on: "2026-08-16",
        expires_on: "2099-01-01",
      },
    });
    const response = await call(TOKEN);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("returns 404 for a rotated-out 16-character token", async () => {
    process.env.HOSTED_REPORT_TOKENS = JSON.stringify({});
    expect((await call("22002a7b2f68dbbe")).status).toBe(404);
  });
});
