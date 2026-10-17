/**
 * The correction notice for one saved Hamilton output (H03-T09, #978): read on the server when a
 * saved answer or report opens. Matches by the fee rows the output recorded, or by its
 * institution for an output saved before rows were recorded. Never throws; the output's own
 * figures are never changed here.
 */
import { sql } from "@/lib/data-store/connection";
import { getSavedOutputChanges } from "@/lib/data-store/fee-correction-audit";
import type { SavedOutputKind } from "@/lib/data-store/saved-output-fee-refs";
import { savedOutputNotice, type SavedOutputNotice } from "@/lib/saved-output-corrections";

export async function savedOutputChangeNotice(output: {
  kind: SavedOutputKind;
  id: string;
  institutionId: string | number | null | undefined;
  savedAt: string | Date | null | undefined;
  noun: string;
}): Promise<SavedOutputNotice | null> {
  const at = output.savedAt instanceof Date ? output.savedAt : output.savedAt ? new Date(output.savedAt) : null;
  if (!at || !Number.isFinite(at.getTime())) return null;
  const savedAt = at.toISOString();
  const n = Number(output.institutionId);
  const institutionId = Number.isSafeInteger(n) && n > 0 ? n : null;
  try {
    const { basis, changes } = await getSavedOutputChanges(sql, { kind: output.kind, id: output.id, institutionId, savedAt });
    return savedOutputNotice(changes, savedAt, output.noun, basis);
  } catch (error) {
    console.error("[saved-output-notice] the notice could not be read", { kind: output.kind, error });
    return null;
  }
}
