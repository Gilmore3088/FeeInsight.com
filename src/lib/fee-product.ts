/** Product applicability is identity. Unassigned is never every product.
 * Fold ASCII case and explicit transport whitespace only. Non-ASCII case/other separators
 * stay distinct, avoiding JavaScript/DB-locale Unicode casefold disagreement.
 */
export function productKey(value: string | null | undefined): string {
  return (value ?? "").replace(/[ \t\r\n\f\v\u00a0]+/g, " ").replace(/^ | $/g, "")
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}
export function sameProduct(one: string | null | undefined, two: string | null | undefined): boolean {
  return productKey(one) === productKey(two);
}
/** Static internal columns only; values remain bound by the caller's SQL tag. */
export function productKeySql(column: string): string {
  if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/i.test(column)) throw new Error("Invalid internal product column");
  return `translate(btrim(regexp_replace(COALESCE(${column}, ''), E'[ \\t\\r\\n\\f\\013 ]+', ' ', 'g')), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')`;
}
