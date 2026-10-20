import { describe, expect, it } from "vitest";
import { institutionNameRank } from "@/lib/data-store/search";
import { sortVerifiedFirst } from "./directory-sort";

const row = (institution_name: string, published_fee_count: number) => ({ institution_name, published_fee_count });

describe("sortVerifiedFirst", () => {
  it("keeps published first, then puts the institution a name search names ahead of the alphabet", () => {
    const rows = [row("First US Bank", 25), row("U.S. Bank National Association", 26), row("American Bank", 0)];
    expect(sortVerifiedFirst(rows).map((r) => r.institution_name)).toEqual(["First US Bank", "U.S. Bank National Association", "American Bank"]);
    expect(sortVerifiedFirst(rows, (name) => institutionNameRank(name, "US Bank")).map((r) => r.institution_name)).toEqual([
      "U.S. Bank National Association",
      "First US Bank",
      "American Bank",
    ]);
  });
});
