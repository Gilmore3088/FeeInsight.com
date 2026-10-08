import { describe, expect, it } from "vitest";
import { requestShape } from "./route-wrapper";

describe("requestShape", () => {
  it("keeps only the view and format of a request", () => {
    expect(requestShape(new Request("https://x.test/api/v1/institutions?id=12&view=benchmark&format=csv&q=secret"))).toEqual({ view: "benchmark", format: "csv" });
    expect(requestShape(new Request("https://x.test/api/v1/institutions?id=12"))).toEqual({});
    expect(requestShape(new Request("https://x.test/a?view=<script>"))).toEqual({});
    expect(requestShape(undefined)).toEqual({});
  });
});
