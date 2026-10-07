import { describe, expect, it } from "vitest";
import { defaultLayer } from "./research-layers";

describe("defaultLayer", () => {
  it("opens on the peer group, not a thin hometown market", () => {
    expect(
      defaultLayer([
        { key: "local", thin: false },
        { key: "state", thin: false },
        { key: "peers", thin: false },
        { key: "national", thin: false },
      ]),
    ).toBe("peers");
  });

  it("falls back to the state, then the nation, when a layer is too thin", () => {
    expect(defaultLayer([{ key: "local", thin: false }, { key: "peers", thin: true }, { key: "state", thin: false }])).toBe("state");
    expect(defaultLayer([{ key: "peers", thin: true }, { key: "state", thin: true }, { key: "national", thin: false }])).toBe("national");
  });
});
