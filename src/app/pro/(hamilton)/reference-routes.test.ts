import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() => vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import { HAMILTON_REFERENCE_NAV } from "@/lib/hamilton/navigation";

const proRoot = join(process.cwd(), "src/app/pro");

describe("Pro reference pages", () => {
  it("render inside the Hamilton shell (the (hamilton) route group)", () => {
    for (const item of HAMILTON_REFERENCE_NAV) {
      const segment = item.href.replace("/pro/", "");
      expect(existsSync(join(proRoot, "(hamilton)", segment, "page.tsx"))).toBe(true);
      expect(existsSync(join(proRoot, segment, "page.tsx"))).toBe(false);
    }
  });

  it("retire the legacy peer builder in favor of Settings peer sets", async () => {
    const { default: LegacyPeersPage } = await import("../peers/page");
    expect(() => LegacyPeersPage()).toThrow("NEXT_REDIRECT:/pro/settings#peer-sets");
  });

  it("send /pro straight to the workspace", async () => {
    const { default: ProIndexPage } = await import("../page");
    expect(() => ProIndexPage()).toThrow("NEXT_REDIRECT:/pro/hamilton");
  });
});
