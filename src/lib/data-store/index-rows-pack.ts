import type { IndexRow } from "./fees";

/**
 * The Bank Fee Index explorer's rows in a compact form for the public read cache.
 *
 * Next's data cache refuses an entry over 2 MB, and a refused entry is read from the database
 * again on the next request. As objects, safe deposit box's rows came to about 3.1 MB on
 * Nov 21 2026 (8,150 rows, each repeating its institution's name and two schedule keys), so
 * /fees?fee=safe_deposit_box and the homepage card re-read the catalog on every render.
 * Packed, every repeated string is stored once and each row is a short array of numbers.
 * unpackIndexRows gives back exactly the rows packIndexRows was given, in the same order.
 */
export interface PackedIndexRows {
  /** Every distinct string the rows use, once. */
  strings: string[];
  /**
   * One tuple per row: id, institution_id, name, amount, charter_type, state_code (-1 null),
   * schedule_group (-1 null), product_exception (1 true, 0 false, -1 null, -2 absent),
   * schedule_keys (string indexes, or null).
   */
  rows: [number, number, number, number, number, number, number, number, number[] | null][];
}

export function packIndexRows(rows: IndexRow[]): PackedIndexRows {
  const strings: string[] = [];
  const index = new Map<string, number>();
  const ref = (value: string | null | undefined): number => {
    if (value == null) return -1;
    let at = index.get(value);
    if (at === undefined) {
      at = strings.length;
      strings.push(value);
      index.set(value, at);
    }
    return at;
  };
  return {
    strings,
    rows: rows.map((r) => [
      r.id,
      r.institution_id,
      ref(r.institution_name),
      r.amount,
      ref(r.charter_type),
      ref(r.state_code),
      ref(r.schedule_group),
      r.product_exception === true ? 1 : r.product_exception === false ? 0 : r.product_exception === null ? -1 : -2,
      Array.isArray(r.schedule_keys) ? r.schedule_keys.map((k) => ref(k)) : null,
    ]),
  };
}

export function unpackIndexRows(packed: PackedIndexRows): IndexRow[] {
  const { strings } = packed;
  const str = (at: number): string | null => (at < 0 ? null : strings[at]);
  return packed.rows.map(([id, institutionId, name, amount, charter, state, group, exception, keys]) => {
    const row: IndexRow = {
      id,
      institution_id: institutionId,
      institution_name: strings[name],
      amount,
      charter_type: strings[charter],
      state_code: str(state),
      schedule_keys: keys === null ? null : keys.map((k) => strings[k]),
      schedule_group: str(group),
    };
    if (exception !== -2) row.product_exception = exception === -1 ? null : exception === 1;
    return row;
  });
}
