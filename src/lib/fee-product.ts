import { isNonCheckingAccount, nonCheckingAccountSql } from "./account-kind";
import { WIRE_CHANNEL_CATEGORIES, namesWireChannel, wireChannelSql } from "./wire-channel";

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
/**
 * Categories whose price belongs to the account itself (a checking account's monthly fee, its
 * minimum balance): a product name there names the account priced, not an exception to a
 * general price, unless it names a non-checking account (#1912, isProductException). Knox's
 * ancillary owner never assigns these (ancillary-product.ts).
 */
export const ACCOUNT_PRICED_CATEGORIES: ReadonlySet<string> = new Set(["monthly_maintenance", "minimum_balance"]);

/**
 * A row priced for one named product as an exception to the institution's general price
 * (#1911: U.S. Bank's Safe Debit money order at $1.65 beside the general $5.00). An unassigned
 * row is general, never every product's. With no category it is not an exception, so a reader
 * that did not select the category keeps its value rather than guessing.
 *
 * In an account-priced category (monthly maintenance, minimum balance) a product name names the
 * account priced, so a checking account's name is no exception. A savings, money market,
 * certificate, IRA, HSA or club account's own fee is (#1912: M&T's $20 Preferred Money Market
 * charge beside its checking accounts' $4.95, $14.95 and $24.95): the bank's value there is its
 * checking price, so the row is set aside as rule 11 sets aside any exception. It stays listed.
 *
 * In the four wire categories a fee name that names a channel (online, phone, fax, PIN, a
 * repetitive or template wire; wire-channel.ts namesWireChannel) is an exception too (#1912,
 * Bank OZK: "Outgoing Online Wire (Domestic)" $20 beside the general $30). "In branch", "in
 * person" and "manual" name the standard channel, so those rows are general. The name is
 * optional: a caller that passes none keeps the product test alone.
 */
export function isProductException(
  category: string | null | undefined,
  product: string | null | undefined,
  feeName?: string | null,
): boolean {
  if (!category) return false;
  if (ACCOUNT_PRICED_CATEGORIES.has(category)) return isNonCheckingAccount(product);
  if (WIRE_CHANNEL_CATEGORIES.has(category) && namesWireChannel(feeName)) return true;
  return productKey(product) !== "";
}

/**
 * SQL twin of isProductException over a catalog alias's account_product_type and fee name
 * (`nameColumn`, default fee_name; null leaves the wire channel test out, like the TS call with
 * no name). Static internal names only.
 */
export function productExceptionSql(alias = "ef", categoryColumn = "fee_category", nameColumn: string | null = "fee_name"): string {
  const name = /^[a-z][a-z0-9_]*$/i;
  if (!name.test(alias) || !name.test(categoryColumn) || (nameColumn !== null && !name.test(nameColumn))) throw new Error("Invalid internal product column");
  const accountPriced = [...ACCOUNT_PRICED_CATEGORIES].map((category) => `'${category}'`).join(", ");
  const wires = [...WIRE_CHANNEL_CATEGORIES].map((category) => `'${category}'`).join(", ");
  const product = `${alias}.account_product_type`;
  const channel = nameColumn === null ? "" : `WHEN ${alias}.${categoryColumn} IN (${wires}) AND ${wireChannelSql(`${alias}.${nameColumn}`)} THEN true `;
  return `COALESCE(CASE WHEN ${alias}.${categoryColumn} IS NULL THEN false WHEN ${alias}.${categoryColumn} IN (${accountPriced}) THEN ${nonCheckingAccountSql(product)} ` +
    channel + `ELSE ${productKeySql(product)} <> '' END, false)`;
}

/** Static internal columns only; values remain bound by the caller's SQL tag. */
export function productKeySql(column: string): string {
  if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/i.test(column)) throw new Error("Invalid internal product column");
  return `translate(btrim(regexp_replace(COALESCE(${column}, ''), E'[ \\t\\r\\n\\f\\013 ]+', ' ', 'g')), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')`;
}
