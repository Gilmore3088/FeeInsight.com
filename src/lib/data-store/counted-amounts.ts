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
