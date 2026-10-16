/**
 * The "Your recent questions" list on Ask: one line per distinct answer, each a whole sentence.
 * A saved title is the answer's first sentence, cut at a fixed length, so a long one can stop
 * mid-thought ("...out of 1,325 midsize institutions overstates"). Those rows are labeled with
 * the question instead. Asking the same thing twice saves two rows with the same answer; the
 * list keeps the newest.
 */
export interface SavedAnalysisRow {
  id: string;
  title: string;
  prompt: string | null;
  institution_id: string | null;
  /** The research institution's name, when the saved row names one that still exists. */
  institution_name?: string | null;
  updated_at: string;
}

export interface RecentQuestion {
  id: string;
  title: string;
  updated_at: string;
}

const MAX_TITLE = 120;

/** A title that ends a sentence (allowing a closing bracket or quote) and is not cut short. */
function isWholeSentence(title: string): boolean {
  return title.length <= MAX_TITLE && !/…$/.test(title) && /[.!?]["”')\]]?$/.test(title);
}

function questionLabel(prompt: string): string {
  const text = prompt.replace(/\s+/g, " ").trim();
  if (!text) return "";
  const cut = text.length > MAX_TITLE ? `${text.slice(0, MAX_TITLE).replace(/\s+\S*$/, "")}…` : text;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}

export function recentLabel(row: Pick<SavedAnalysisRow, "title" | "prompt">): string {
  const title = row.title.replace(/\s+/g, " ").trim();
  if (isWholeSentence(title)) return title;
  return questionLabel(row.prompt ?? "") || title;
}

/**
 * A saved line names the institution it is about (#1542): "What about their overdraft fee?" alone
 * can't tell two banks apart. A label that already names it is left as it is.
 */
export function withInstitution(label: string, institutionName: string | null | undefined): string {
  const name = institutionName?.replace(/\s+/g, " ").trim();
  if (!name) return label;
  const shown = name.replace(/,?\s+(?:National Association|N\.A\.?)$/i, "").trim();
  const core = shown.replace(/\s+(?:Federal Credit Union|Credit Union|FCU|Bank)$/i, "").trim() || shown;
  return label.toLowerCase().includes(core.toLowerCase()) ? label : `${label} · ${shown}`;
}

/** Newest first in, newest first out: one row per institution and label, at most `limit`. */
export function recentQuestions(rows: readonly SavedAnalysisRow[], limit: number): RecentQuestion[] {
  const seen = new Set<string>();
  const out: RecentQuestion[] = [];
  for (const row of rows) {
    const title = recentLabel(row);
    const key = `${row.institution_id ?? ""}|${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: row.id, title: withInstitution(title, row.institution_name), updated_at: row.updated_at });
    if (out.length >= limit) break;
  }
  return out;
}
