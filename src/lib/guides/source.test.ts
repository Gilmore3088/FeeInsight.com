import { beforeEach, describe, expect, it, vi } from "vitest";

const { stored } = vi.hoisted(() => ({ stored: vi.fn() }));
vi.mock("@/lib/data-store/guides", () => ({ getGuidesForCategory: stored }));

import { CONSUMER_GUIDES } from "./catalog-consumer";
import { loadGuidesForCategory } from "./source";

const guide = (slug: string) => CONSUMER_GUIDES.find((g) => g.slug === slug)!;

beforeEach(() => stored.mockReset());

describe("loadGuidesForCategory leads with the fee's own guide (#1953)", () => {
  it("puts the NSF guide first on /fees/nsf from the seed", async () => {
    stored.mockRejectedValueOnce(new Error("no table"));
    const guides = await loadGuidesForCategory("nsf", "consumer");
    expect(guides[0].slug).toBe("nsf-fees");
    expect(guides.map((g) => g.slug)).toContain("overdraft-fees");
  });

  it("reorders stored guides so the primary one leads", async () => {
    stored.mockResolvedValueOnce([guide("overdraft-fees"), guide("nsf-fees")]);
    expect((await loadGuidesForCategory("nsf", "consumer"))[0].slug).toBe("nsf-fees");
  });

  it("leads with the seed's guide when the stored set has none written about the fee", async () => {
    stored.mockResolvedValueOnce([guide("overdraft-fees")]);
    expect((await loadGuidesForCategory("nsf", "consumer")).map((g) => g.slug)).toEqual(["nsf-fees", "overdraft-fees"]);
  });
});
