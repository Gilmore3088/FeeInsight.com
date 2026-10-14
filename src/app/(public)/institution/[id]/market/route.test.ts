import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "./route";

// NORMAN's Oct 9 dry run: 23 unsent outreach drafts linked to /institution/{id}/market, a 404.
describe("/institution/[id]/market", () => {
  it("sends the outreach link to the institution profile with its UTM tags", async () => {
    const url = "https://feeinsight.com/institution/734/market?utm_source=email&utm_medium=outreach&utm_content=inst-734";
    const response = await GET(new NextRequest(url), { params: Promise.resolve({ id: "734" }) });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://feeinsight.com/institution/734?utm_source=email&utm_medium=outreach&utm_content=inst-734",
    );
  });

  it("sends a malformed id to the directory", async () => {
    const response = await GET(new NextRequest("https://feeinsight.com/institution/abc/market"), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(response.headers.get("location")).toBe("https://feeinsight.com/institutions");
  });
});
