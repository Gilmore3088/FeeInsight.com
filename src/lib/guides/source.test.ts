import { beforeEach, describe, expect, it, vi } from "vitest";

const { stored, published } = vi.hoisted(() => ({ stored: vi.fn(), published: vi.fn() }));
vi.mock("@/lib/data-store/guides", () => ({ getGuidesForCategory: stored, getPublishedGuides: published }));

import { CONSUMER_GUIDES } from "./catalog-consumer";
import { SEED_GUIDES, loadGuidesForCategory, loadGuidesWithSource } from "./source";

const guide = (slug: string) => CONSUMER_GUIDES.find((g) => g.slug === slug)!;

beforeEach(() => {
  stored.mockReset();
  published.mockReset();
});

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

describe("loadGuidesWithSource says when the seed serves because a read failed (#1811)", () => {
  it("reports a failed read, logs it and serves the seed", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    published.mockRejectedValueOnce(new Error("connection reset"));
    expect(await loadGuidesWithSource()).toEqual({ guides: SEED_GUIDES, source: "seed", readFailed: true });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("serves the seed without a failure when the table is reachable but empty", async () => {
    published.mockResolvedValueOnce([]);
    expect(await loadGuidesWithSource()).toEqual({ guides: SEED_GUIDES, source: "seed", readFailed: false });
  });

  it("serves stored guides from the database", async () => {
    published.mockResolvedValueOnce([guide("nsf-fees")]);
    expect(await loadGuidesWithSource()).toEqual({
      guides: [guide("nsf-fees")],
      source: "database",
      readFailed: false,
    });
  });
});
