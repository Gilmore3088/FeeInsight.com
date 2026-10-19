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

/**
 * The stored spellings that name the same city as `asked`, upper case, `asked` first. A read that
 * matches one city by name sends this list (`UPPER(city) = ANY(...)`), so "Saint Petersburg" on a
 * headquarters record and "ST. PETERSBURG" on a branch record land on the same page. A name the
 * fold does not know still matches itself. Pure.
 */
export function sameCitySpellings(asked: string, stored: Iterable<string>): string[] {
  const upper = asked.toUpperCase();
  const key = cityKey(upper);
  const out = new Set<string>([upper]);
  if (!key) return [...out];
  for (const s of stored) {
    const name = String(s ?? "").toUpperCase();
    if (name && cityKey(name) === key) out.add(name);
  }
  return [...out];
}

/** One place as a record spells it: a state code and a city name. */
export interface StatePlace {
  state: string;
  city: string;
}

/**
 * The candidate places that are one of the target places once spellings are folded, as
 * "STATE|CITY" with the candidate's own upper-case spelling, so a query can match them exactly
 * (`(state || '|' || UPPER(city)) = ANY(...)`). Pure.
 */
export function placesInFold(targets: Iterable<StatePlace>, candidates: Iterable<StatePlace>): string[] {
  const wanted = new Set<string>();
  for (const t of targets) {
    const key = cityKey(String(t.city ?? ""));
    if (key && t.state) wanted.add(`${String(t.state).toUpperCase()}|${key}`);
  }
  const out = new Set<string>();
  for (const c of candidates) {
    const city = String(c.city ?? "").toUpperCase();
    const state = String(c.state ?? "").toUpperCase();
    if (city && state && wanted.has(`${state}|${cityKey(city)}`)) out.add(`${state}|${city}`);
  }
  return [...out];
}

/**
 * The prefixes a typed city search is matched with, so its first word reads in each of its folded
 * forms: "st pete" also looks for "SAINT pete" and "ST. pete", "fort worth" also for "FT worth".
 * The search as typed always comes first. A first word typed alone ("st") gets its other forms
 * only as whole words ("SAINT ", "ST. "), since it may be the start of another name. Pure.
 */
export function citySearchPrefixes(query: string): string[] {
  const typed = query.trim();
  const match = /^(\p{L}+)\.?(\s.*)?$/u.exec(typed);
  if (!match) return [typed];
  const first = match[1].toUpperCase();
  const short = SAME_WORD[first] ?? (first in LONG_FORM ? first : null);
  if (!short) return [typed];
  const rest = match[2] ? ` ${match[2].trim()}` : " ";
  const forms = [LONG_FORM[short], short, `${short}.`];
  return [...new Set([typed, ...forms.map((form) => `${form}${rest}`)])];
}
