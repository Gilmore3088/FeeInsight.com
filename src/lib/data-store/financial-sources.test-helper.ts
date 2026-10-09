/**
 * Test helper: the SQL texts from a mocked `sql` tag (template strings joined) and
 * `sql.unsafe` (first argument) that read institution_financial_records with fewer
 * fdic/ncua source filters than reads. An empty result means every read is filtered.
 */
export function unfilteredFinancialReads(mock: {
  mock: { calls: unknown[][] };
  unsafe?: { mock: { calls: unknown[][] } };
}): string[] {
  const text = (first: unknown) => (Array.isArray(first) ? first.join(" ") : String(first));
  const texts = [
    ...mock.mock.calls.map((call) => text(call[0])),
    ...(mock.unsafe?.mock.calls ?? []).map((call) => text(call[0])),
  ].filter((t) => /(FROM|JOIN)\s+institution_financial_records/.test(t));
  if (texts.length === 0) return ["no institution_financial_records read was captured"];
  return texts.filter((t) => {
    const reads = t.match(/(FROM|JOIN)\s+institution_financial_records/g)?.length ?? 0;
    const filters = t.match(/source (IN \('fdic', 'ncua'\)|= 'fdic'|= 'ncua')/g)?.length ?? 0;
    return filters < reads;
  });
}
