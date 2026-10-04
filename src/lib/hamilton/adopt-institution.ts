/**
 * Make a real institution "my institution": the account profile takes its name, charter,
 * asset tier, state and district (so every screen that reads the profile agrees), and a
 * Pro user's Hamilton workspace is anchored to it.
 */

import { sql } from "@/lib/data-store/connection";
import { getInstitutionById } from "@/lib/data-store";
import { setHamiltonWorkspaceContext, type HamiltonWorkspaceContextSource } from "./workspace-context";

const PROFILE_CHARTERS = new Set(["bank", "credit_union"]);

export async function adoptInstitution(params: {
  userId: number;
  institutionId: number;
  /** Anchor the Hamilton workspace too (Pro users only). */
  setWorkspace: boolean;
  source: HamiltonWorkspaceContextSource;
  intent?: string | null;
}): Promise<{ id: number; name: string } | null> {
  const institution = await getInstitutionById(params.institutionId);
  if (!institution) return null;

  const charter = PROFILE_CHARTERS.has(institution.charter_type) ? institution.charter_type : null;
  await sql`
    UPDATE users
    SET institution_name = ${institution.institution_name},
        institution_type = COALESCE(${charter}, institution_type),
        asset_tier       = ${institution.asset_size_tier ?? null},
        state_code       = ${institution.state_code ?? null},
        fed_district     = ${institution.fed_district ?? null}
    WHERE id = ${params.userId}
  `;

  if (params.setWorkspace) {
    await setHamiltonWorkspaceContext({
      userId: params.userId,
      institutionId: institution.id,
      source: params.source,
      intent: params.intent ?? null,
    });
  }
  return { id: institution.id, name: institution.institution_name };
}
