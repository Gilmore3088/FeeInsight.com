/**
 * One amount per counted institution. Pure: no database imports, so client components can reach
 * it (hamilton/workspace/segment.ts is imported by ScopeControls, a client component, and anything
 * that pulls in connection.ts breaks the production build).
 */
/**
 * Rule 7 for values that are already one per institution (Hamilton's peers): institutions with the
 * same `countedAs` (their representative from countedRepresentatives) count once, at the lower
 * middle of their values, as summarizeFees counts them. Sorted ascending.
 */
export function countedAmounts(values: readonly { institutionId: number; amount: number; countedAs?: number | null }[]): number[] {
  const members = new Map<number, number[]>();
  for (const value of values) {
    const key = value.countedAs ?? value.institutionId;
    const list = members.get(key);
    if (list) list.push(value.amount);
    else members.set(key, [value.amount]);
  }
  return [...members.values()]
    .map((list) => [...list].sort((a, b) => a - b)[Math.floor((list.length - 1) / 2)])
    .sort((a, b) => a - b);
}

/**
 * How many institutions these count as under rule 7 when each carries its representative per fee
 * category (`countedAs`, as the local market reader gives it): sister charters linked on any fee
 * count once. Every institution still keeps its own named row; this is only the count.
 */
export function countedInstitutionGroups(items: readonly { institutionId: number; countedAs?: Record<string, number> | null }[]): number {
  const parent = new Map<number, number>();
  const find = (id: number): number => {
    let root = id;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root) as number;
    return root;
  };
  for (const item of items) {
    if (!parent.has(item.institutionId)) parent.set(item.institutionId, item.institutionId);
    for (const rep of Object.values(item.countedAs ?? {})) {
      if (!parent.has(rep)) parent.set(rep, rep);
      const a = find(item.institutionId);
      const b = find(rep);
      if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
    }
  }
  return new Set(items.map((item) => find(item.institutionId))).size;
}
