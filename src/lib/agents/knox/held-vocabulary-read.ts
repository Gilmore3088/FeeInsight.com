import { withHeldNameVocabulary } from "@/lib/agents/knox/held-name-vocabulary";
import { classifyFeeText } from "@/lib/agents/knox/rules";

/**
 * v156: a name only the held-name vocabulary files: main's rules name no category for it, today's
 * do. Hamilton's publish refuses such a read where a live fee already holds its printed line in any
 * category (`selectLiveFeeOnLine`), so the vocabulary only admits. Pure.
 */
export function vocabularyOnlyName(name: string | null | undefined): boolean {
  const text = (name ?? "").trim();
  if (!text) return false;
  return classifyFeeText(text) != null && withHeldNameVocabulary(false, () => classifyFeeText(text)) == null;
}
