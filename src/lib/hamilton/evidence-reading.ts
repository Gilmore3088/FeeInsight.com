/**
 * A saved derivation in a reader's words (#981, H06-T05): the sign decides "higher", "lower" or
 * "the same as", and every reading names both input values and their dates, so a difference never
 * reads as a fee and a decline never reads as a rise. Readings only describe a derivation that
 * deriveDifference / derivePercentChange already accepted; anything else reads as null.
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
