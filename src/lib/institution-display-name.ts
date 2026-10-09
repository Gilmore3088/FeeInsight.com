/**
 * The name shown for an institution. `institution_sources.institution_name` keeps the registry
 * name as loaded; some of those read badly in print: "Denver Community Cu D.B.A. Zing Cu Federal
 * Credit Union" (a "doing business as" name with the charter words appended) or "Metro Cu Federal
 * Credit Union" (the registry's "CU" abbreviation with "Federal Credit Union" added after it).
 *
 * - A "dba" name is the one the institution trades under, so it is shown, unless it is a bare
 *   acronym ("..., DBA HSLC"), which says less than the legal name.
 * - A name that abbreviates "CU" mid-name and then repeats "Federal Credit Union" drops the
 *   repeated suffix and spells the abbreviation out. A leading "CU" is the brand ("CU Hawaii
 *   Federal Credit Union") and stays.
 */

const DBA = /\s*,?\s+d\.?\s?b\.?\s?a\.?\s+/i;
const REPEATED_SUFFIX = /\s+Federal Credit Union$/;
const MID_CU = /(?<=\S\s+)Cu\b/;

export function institutionDisplayName(raw: string): string;
export function institutionDisplayName<T extends null | undefined>(raw: string | T): string | T;
export function institutionDisplayName(raw: string | null | undefined): string | null | undefined {
  if (raw == null) return raw;
  let name = raw.replace(/\s+/g, " ").trim();
  if (!name) return name;

  const dba = name.split(DBA);
  if (dba.length === 2) {
    const [legal, trading] = dba.map((part) => part.trim().replace(/,$/, ""));
    if (trading && !/^[A-Z0-9&]{2,5}$/.test(trading)) name = trading;
    else name = legal;
  }

  if (REPEATED_SUFFIX.test(name) && MID_CU.test(name.replace(REPEATED_SUFFIX, ""))) {
    name = name
      .replace(REPEATED_SUFFIX, "")
      .replace(/(?<=\S\s+)Cu\b/g, "Credit Union")
      .replace(/\bEmps\b/g, "Employees")
      .replace(/,?\s+Inc\.?$/i, "")
      .replace(/(?<=\S\s)(Of|And|The)\b/g, (word) => word.toLowerCase());
  }
  return name;
}
