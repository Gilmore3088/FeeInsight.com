import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

describe("/research/state picker redirect", () => {
  it("sends a known state code to its report", () => {
    const res = GET(new NextRequest("https://feeinsight.com/research/state?state=fl"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://feeinsight.com/research/state/FL");
  });

  it("sends anything else back to the picker", () => {
    const res = GET(new NextRequest("https://feeinsight.com/research/state?state=../x"));
    expect(res.headers.get("location")).toBe("https://feeinsight.com/research#find");
  });
});
