/**
 * A saved derivation in a reader's words (#981, H06-T05): the sign decides "higher", "lower" or
 * "the same as", and every reading names both input values and their dates, so a difference never
 * reads as a fee and a decline never reads as a rise. Readings only describe a derivation that
 * deriveDifference / derivePercentChange already accepted; anything else reads as null.
 */
import { readerAsOf } from "./board-brief";
import type { HamiltonDerivedFact, HamiltonEvidenceFact } from "./evidence-contract";

function money(value: number): string {
  return Number.isInteger(value) ? `$${value.toLocaleString("en-US")}` : `$${value.toFixed(2)}`;
}

function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

/** Names for the institutions in the inputs; an unnamed one reads as "Institution 12". */
export type InstitutionNames = ReadonlyMap<number, string>;

function nameOf(fact: HamiltonEvidenceFact, names: InstitutionNames): string {
  const id = fact.scope.institutionId;
  return id === null ? "An unnamed institution" : names.get(id) ?? `Institution ${id}`;
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

  if (derived.derivation.kind === "difference" && derived.unit === "usd") {
    const left = `${possessive(nameOf(first, names))} ${feeLabel} fee`;
    const right = possessive(nameOf(second, names));
    const values = `${money(first.value)} vs ${money(second.value)}, both as of ${firstDate}`;
    if (derived.value === 0) return `${left} is the same as ${right} (${values}).`;
    const gap = money(Math.abs(derived.value));
    return `${left} is ${gap} ${derived.value > 0 ? "higher" : "lower"} than ${right} (${values}).`;
  }
  if (derived.derivation.kind === "percent_change" && derived.unit === "percent") {
    const subject = `${possessive(nameOf(first, names))} ${feeLabel} fee`;
    const span = `from ${money(second.value)} (${secondDate}) to ${money(first.value)} (${firstDate})`;
    if (derived.value === 0) return `${subject} did not change, ${span}.`;
    return `${subject} ${derived.value > 0 ? "rose" : "fell"} ${Math.abs(derived.value).toFixed(1)}%, ${span}.`;
  }
  return null;
}
