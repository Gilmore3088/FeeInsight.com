/**
 * A saved derivation in a reader's words (#981, H06-T05): the sign decides "higher", "lower" or
 * "the same as", and every reading names both input values and their dates, so a difference never
 * reads as a fee and a decline never reads as a rise. `readDerivation` only describes a derivation
 * that deriveDifference / derivePercentChange already accepted; `readRefusal` explains the few
 * refusals a reader needs to see (#1717); anything else reads as null.
 */
import { readerAsOf } from "./board-brief";
import type { HamiltonDerivedFact, HamiltonEvidenceFact } from "./evidence-contract";

function money(value: number): string {
  const digits = Number.isInteger(value) ? 0 : 2;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

/** Names for the institutions in the inputs; one with no name here reads as "Institution 12". */
export type InstitutionNames = ReadonlyMap<number, string>;

function nameOf(fact: HamiltonEvidenceFact, names: InstitutionNames): string {
  const id = fact.scope.institutionId;
  return id === null ? "an unnamed institution" : names.get(id) ?? `Institution ${id}`;
}

export function readDerivation(
  derived: HamiltonDerivedFact,
  inputs: readonly HamiltonEvidenceFact[],
  names: InstitutionNames,
  feeLabel: string,
): string | null {
  const byId = new Map(inputs.map((fact) => [fact.id, fact]));
  const [first, second] = derived.derivation.inputFactIds.map((id) => byId.get(id));
  if (!first || !second || typeof derived.value !== "number" || !Number.isFinite(derived.value)) return null;
  if (typeof first.value !== "number" || typeof second.value !== "number") return null;
  const firstDate = first.scope.reportingDate ? readerAsOf(first.scope.reportingDate) : null;
  const secondDate = second.scope.reportingDate ? readerAsOf(second.scope.reportingDate) : null;
  if (!firstDate || !secondDate) return null;

  // Re-check the saved value against its inputs, so a hand-built or stale derivation never reads as fact.
  if (derived.derivation.kind === "difference" && derived.unit === "usd") {
    if (firstDate !== secondDate || Math.abs(first.value - second.value - derived.value) > 0.005) return null;
    const left = `${possessive(nameOf(first, names))} ${feeLabel} fee`;
    const right = possessive(nameOf(second, names));
    const values = `${money(first.value)} vs ${money(second.value)}, both as of ${firstDate}`;
    if (derived.value === 0) return sentence(`${left} is the same as ${right} (${values}).`);
    const gap = money(Math.abs(derived.value));
    return sentence(`${left} is ${gap} ${derived.value > 0 ? "higher" : "lower"} than ${right} (${values}).`);
  }
  if (derived.derivation.kind === "percent_change" && derived.unit === "percent") {
    if (second.value === 0) return null;
    const exact = ((first.value - second.value) / second.value) * 100;
    if (Math.abs(exact - derived.value) > 0.05 + 1e-9) return null;
    const subject = `${possessive(nameOf(first, names))} ${feeLabel} fee`;
    const span = `from ${money(second.value)} (${secondDate}) to ${money(first.value)} (${firstDate})`;
    if (first.value === second.value) return sentence(`${subject} did not change, ${span}.`);
    // A change that rounds to 0.0% still happened; say how small it was rather than "did not change".
    const size = Math.abs(derived.value) < 0.1 ? "less than 0.1%" : `${Math.abs(derived.value).toFixed(1)}%`;
    return sentence(`${subject} ${exact > 0 ? "rose" : "fell"} ${size}, ${span}.`);
  }
  return null;
}

function datedValue(fact: HamiltonEvidenceFact): { value: number; date: string } | null {
  if (typeof fact.value !== "number" || !Number.isFinite(fact.value) || !fact.scope.reportingDate) return null;
  const date = readerAsOf(fact.scope.reportingDate);
  return date ? { value: fact.value, date } : null;
}

/**
 * A comparison deriveDifference / derivePercentChange refused or limited, in a reader's words
 * (#1717). It reads only the refusals it can explain in full, and every reading shows both dated
 * values:
 * - `zero_denominator` alone (a change from $0): "a new $10 fee (was $0 ...)", or "did not change"
 *   when the new value is $0 too. No percent is ever stated.
 * - `reporting_period_mismatch` alone: both values and dates, and why they aren't one comparison.
 * - `reporting_period_order_invalid` alone: why the older value can't be the current one.
 * Any other problem, or several, reads as null: the comparison is simply not shown.
 * `left` and `right` are the inputs in the order they were passed (current, prior for a change).
 */
export function readRefusal(
  problems: readonly string[],
  left: HamiltonEvidenceFact,
  right: HamiltonEvidenceFact,
  names: InstitutionNames,
  feeLabel: string,
): string | null {
  const codes = [...new Set(problems)];
  if (codes.length !== 1) return null;
  const a = datedValue(left);
  const b = datedValue(right);
  if (!a || !b) return null;
  const leftName = nameOf(left, names);
  const rightName = nameOf(right, names);
  const sameBank = left.scope.institutionId !== null && left.scope.institutionId === right.scope.institutionId;

  if (codes[0] === "zero_denominator") {
    if (!sameBank || b.value !== 0 || left.scope.reportingDate! <= right.scope.reportingDate!) return null;
    const subject = `${possessive(leftName)} ${feeLabel} fee`;
    if (a.value === 0) return sentence(`${subject} did not change, from $0 (${b.date}) to $0 (${a.date}).`);
    return sentence(`${subject} is a new ${money(a.value)} fee (was $0 on ${b.date}; ${money(a.value)} on ${a.date}).`);
  }
  if (codes[0] === "reporting_period_mismatch") {
    if (a.date === b.date) return null;
    return sentence(`Not compared: ${possessive(leftName)} ${money(a.value)} is as of ${a.date} and ${possessive(rightName)} ${money(b.value)} is as of ${b.date}; fees from different dates aren't one comparison.`);
  }
  if (codes[0] === "reporting_period_order_invalid") {
    if (!sameBank) return null;
    if (a.date === b.date) {
      return sentence(`Not compared as a change: both of ${possessive(leftName)} ${feeLabel} fees are as of ${a.date} (${money(a.value)} and ${money(b.value)}), so neither is the earlier one.`);
    }
    return sentence(`Not compared as a change: ${possessive(leftName)} ${money(a.value)} (${a.date}) is older than its ${money(b.value)} (${b.date}), so it can't be the current ${feeLabel} fee.`);
  }
  return null;
}
