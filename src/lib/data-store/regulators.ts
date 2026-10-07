import { getSql } from "./connection";

/** An institution's primary federal regulator and chartering agency, as FDIC BankFind or NCUA file them. */
export interface InstitutionRegulators {
  /** "OCC", "FDIC", "Federal Reserve", "NCUA" or "State"; null when not on file. */
  primaryRegulator: string | null;
  /** "OCC", "NCUA" or "State" (a state agency); null when not on file. */
  charterAgency: string | null;
  /** "fdic" or "ncua": the registry the row came from. */
  source: string | null;
}

export async function getInstitutionRegulators(institutionId: number): Promise<InstitutionRegulators | null> {
  const sql = getSql();
  const [row] = await sql`
    SELECT primary_regulator, charter_agency, source
      FROM institution_sources
     WHERE id = ${institutionId}
  `;
  if (!row) return null;
  return {
    primaryRegulator: (row.primary_regulator as string | null) ?? null,
    charterAgency: (row.charter_agency as string | null) ?? null,
    source: (row.source as string | null) ?? null,
  };
}
