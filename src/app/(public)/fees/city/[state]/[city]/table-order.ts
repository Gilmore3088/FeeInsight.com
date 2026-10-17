import type { CityFeeKey, CityMarketInstitution } from "@/lib/data-store";
import type { CitySort } from "./format";

export type CharterFilter = "all" | "bank" | "credit_union";

/**
 * The table's rows for a search, a charter filter and an order. Sorting by fee puts the
 * institutions without a published amount last, most branches first. Pure, for the client table.
 */
export function orderInstitutions(
  list: CityMarketInstitution[],
  fee: CityFeeKey,
  sort: CitySort,
  charter: CharterFilter,
  query: string,
): CityMarketInstitution[] {
  const q = query.trim().toLowerCase();
  const rows = list.filter(
    (i) =>
      (charter === "all" || i.charter === charter) &&
      (!q || i.name.toLowerCase().includes(q) || (i.hq_city ?? "").toLowerCase().includes(q)),
  );
  const byBranches = (a: CityMarketInstitution, b: CityMarketInstitution) => b.branches - a.branches || a.name.localeCompare(b.name);
  if (sort === "name") return rows.sort((a, b) => a.name.localeCompare(b.name));
  // The loader's order: branches here, then deposits here, then name.
  if (sort === "branches") return rows;
  const dir = sort === "low" ? 1 : -1;
  return rows.sort((a, b) => {
    const x = a.fees[fee]?.amount;
    const y = b.fees[fee]?.amount;
    if (x == null || y == null) return x == null && y == null ? byBranches(a, b) : x == null ? 1 : -1;
    return (x - y) * dir || byBranches(a, b);
  });
}
