/**
 * One city, however its branch records spell it (James, Oct 19: "Saint Petersburg, St
 * Petersburg, St. Petersburg and St. Petersberg" were four cities on the Florida explorer).
 *
 * FDIC Summary of Deposits and NCUA branch records spell the same place several ways. Every
 * city list folds them here before it counts anything, so an institution with branches under two
 * spellings counts once, and a reader's search ("St Pete") finds the city whatever they type.
 * This is a read-side fold: the stored records keep their own spelling. Pure.
 */

/** Words that mean the same in a place name, folded to one form. */
const SAME_WORD: Record<string, string> = {
  SAINT: "ST",
  SAINTE: "STE",
  FORT: "FT",
  MOUNT: "MT",
};

/**
 * Misspellings seen in the branch records, each mapped to the place's own spelling. Add new
 * ones below; a word here is corrected in every state.
 */
const MISSPELLED: Record<string, string> = {
  PETERSBERG: "PETERSBURG",
};

/** Upper case, punctuation dropped, hyphens and runs of spaces read as one space. */
function words(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[.,'’`"()]/g, "")
    .replace(/[-/]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * The key one city shares across its spellings: "Saint Petersburg", "St Petersburg",
 * "ST. PETERSBURG" and "St. Petersberg" all give "ST PETERSBURG".
 */
export function cityKey(name: string): string {
  return words(name)
    .map((w) => MISSPELLED[w] ?? w)
    .map((w) => SAME_WORD[w] ?? w)
    .join(" ");
}

/** True when a spelling carries a known misspelling, so it is never chosen as the city's name. */
export function isMisspelled(name: string): boolean {
  return words(name).some((w) => w in MISSPELLED);
}

/** The spelling with its known misspellings corrected and its case kept: "St. Petersberg" reads "St. Petersburg". */
export function correctSpelling(name: string): string {
  return name.replace(/[\p{L}]+/gu, (w) => {
    const fixed = MISSPELLED[w.toUpperCase()];
    if (!fixed) return w;
    if (w === w.toUpperCase()) return fixed;
    return fixed.charAt(0) + fixed.slice(1).toLowerCase();
  });
}

/** One spelling of a city as a read returns it, with how many branches carry that spelling. */
export interface CitySpelling<T> {
  name: string;
  branches: number;
  row: T;
}

/** The spellings that share a key, the first being the one a page names and links to. */
export interface FoldedCity<T> {
  key: string;
  /** The spelling the city is shown and linked under: the most used one without a misspelling. */
  name: string;
  spellings: CitySpelling<T>[];
}

/**
 * Groups spellings of the same city under one key. The city's name is the spelling most branches
 * use, a misspelled one only when it is the only spelling (its address must still match a stored
 * record). Ties go to the spelling that sorts first, so the choice is stable. Order of the output
 * follows the first appearance of each key.
 */
export function foldCitySpellings<T>(spellings: CitySpelling<T>[]): FoldedCity<T>[] {
  const byKey = new Map<string, CitySpelling<T>[]>();
  for (const s of spellings) {
    const key = cityKey(s.name);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(s);
    byKey.set(key, list);
  }
  return [...byKey.entries()].map(([key, list]) => {
    const ranked = [...list].sort(
      (a, b) => Number(isMisspelled(a.name)) - Number(isMisspelled(b.name)) || b.branches - a.branches || a.name.localeCompare(b.name),
    );
    return { key, name: ranked[0].name, spellings: ranked };
  });
}

/** The full word a folded short form stands for: "ST" reads as "SAINT" too, so "sain" finds it. */
const LONG_FORM: Record<string, string> = Object.fromEntries(Object.entries(SAME_WORD).map(([long, short]) => [short, long]));

/**
 * Whether a reader's search finds a city. The search and the name are folded the same way, then
 * the search's words must run in order through the name's words, the last one typed perhaps only
 * in part: "st pete", "Saint Pete" and "St. Petersberg" all find St. Petersburg, "lauderdale"
 * finds Fort Lauderdale, "sain" finds every St. city. An empty search finds every city.
 */
export function cityMatches(query: string, name: string): boolean {
  const raw = words(query);
  if (raw.length === 0) return true;
  const typed = raw.map((w) => SAME_WORD[MISSPELLED[w] ?? w] ?? MISSPELLED[w] ?? w);
  // A last word the fold changed ("saint") was typed in full, so it must match a whole word.
  const lastWhole = typed[typed.length - 1] !== raw[raw.length - 1];
  const lastRaw = raw[raw.length - 1];
  const target = cityKey(name).split(" ");
  for (let i = 0; i + typed.length <= target.length; i++) {
    let ok = true;
    for (let j = 0; j < typed.length && ok; j++) {
      const word = target[i + j];
      if (j < typed.length - 1 || lastWhole) ok = word === typed[j];
      else ok = word.startsWith(typed[j]) || (LONG_FORM[word] ?? "").startsWith(lastRaw);
    }
    if (ok) return true;
  }
  return false;
}
