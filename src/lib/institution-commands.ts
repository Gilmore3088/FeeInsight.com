"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "./auth";
import { sql, withTransaction } from "./data-store/connection";
import { startAgentRun } from "./agents/run-store";

export interface InstitutionCommandResult {
  success: boolean;
  error?: string;
  jobId?: number;
  reused?: boolean;
}

export interface CreateInstitutionInput {
  name: string;
  stateCode: string;
  charterType: "bank" | "credit_union";
  websiteUrl?: string;
  feeScheduleUrl?: string;
}

export interface BulkInstitutionUrlResult {
  success: boolean;
  updated: number;
  errors: string[];
}

function validateInstitutionId(institutionId: number): void {
  if (!Number.isInteger(institutionId) || institutionId < 1) {
    throw new Error("Invalid institution ID");
  }
}

function normalizeHttpUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must use http or https");
  }
  // "https://HTTP://WWW.BANKWITHCHOICE.COM" parses with the host "http" (#1754).
  if (!url.hostname.includes(".")) throw new Error("URL needs a full domain name, like https://www.example.com");
  return url.toString();
}

function revalidateInstitutionSurfaces(institutionId: number, stateCode?: string): void {
  revalidatePath(`/admin/institution/${institutionId}`);
  revalidatePath(`/admin/peers/${institutionId}`);
  if (stateCode) revalidatePath(`/admin/states/${stateCode}`);
  revalidatePath("/admin/magellan");
  revalidatePath("/admin");
}

/**
 * A fee link a person sets replaces the profile's remembered address too (#1881). Magellan fetches
 * the remembered address first, so changing only `fee_schedule_url` left Texas Capital's new PDF
 * unread on Oct 18. A person's link wins over a locked correction as well: it is the newer word.
 */
async function rememberPersonFeeUrl(tx: typeof sql, institutionId: number, url: string): Promise<void> {
  await tx`
    UPDATE institution_source_profiles
       SET canonical_source_url = ${url},
           updated_at = NOW()
     WHERE institution_id = ${institutionId}
  `;
}

export async function createInstitutionCommand(
  input: CreateInstitutionInput,
): Promise<InstitutionCommandResult & { id?: number }> {
  await requireAuth("edit");
  try {
    const name = input.name.trim();
    const stateCode = input.stateCode.trim().toUpperCase();
    if (name.length < 2) throw new Error("Name is required");
    if (!/^[A-Z]{2}$/.test(stateCode)) throw new Error("Invalid state code");
    const websiteUrl = input.websiteUrl ? normalizeHttpUrl(input.websiteUrl) : null;
    const feeScheduleUrl = input.feeScheduleUrl ? normalizeHttpUrl(input.feeScheduleUrl) : null;
    const [row] = await sql`
      INSERT INTO institution_sources
        (institution_name, state_code, charter_type, website_url,
         fee_schedule_url, source, status)
      VALUES
        (${name}, ${stateCode}, ${input.charterType}, ${websiteUrl},
         ${feeScheduleUrl}, 'manual', 'active')
      RETURNING id
    `;
    revalidatePath("/admin/magellan");
    revalidatePath("/admin/institutions");
    revalidatePath("/admin");
    return { success: true, id: Number(row.id) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function setInstitutionFeeUrl(
  institutionId: number,
  value: string,
): Promise<InstitutionCommandResult> {
  await requireAuth("edit");
  try {
    validateInstitutionId(institutionId);
    const url = normalizeHttpUrl(value);
    const rows = await withTransaction(async (tx) => {
      const updated = await tx`
        UPDATE institution_sources
           SET fee_schedule_url = ${url},
               document_type = NULL
         WHERE id = ${institutionId}
         RETURNING state_code
      `;
      if (updated.length > 0) await rememberPersonFeeUrl(tx, institutionId, url);
      return updated;
    });
    if (rows.length === 0) return { success: false, error: "Institution not found" };
    revalidateInstitutionSurfaces(institutionId, String(rows[0].state_code ?? ""));
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * An institution's website, set by a person on its admin page (#1754: Choice Financial's was stored
 * as "https://HTTP://WWW.BANKWITHCHOICE.COM" and James had no way to fix it). The homepage, without
 * a trailing slash, as the registry stores it.
 */
export async function setInstitutionWebsiteUrl(
  institutionId: number,
  value: string,
): Promise<InstitutionCommandResult> {
  await requireAuth("edit");
  try {
    validateInstitutionId(institutionId);
    const url = normalizeHttpUrl(value).replace(/\/$/, "");
    const rows = await sql`
      UPDATE institution_sources
         SET website_url = ${url}
       WHERE id = ${institutionId}
       RETURNING state_code
    `;
    if (rows.length === 0) return { success: false, error: "Institution not found" };
    revalidateInstitutionSurfaces(institutionId, String(rows[0].state_code ?? ""));
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function markInstitutionOfflineCommand(
  institutionId: number,
): Promise<InstitutionCommandResult> {
  await requireAuth("edit");
  try {
    validateInstitutionId(institutionId);
    const rows = await sql`
      UPDATE institution_sources
         SET fee_schedule_url = NULL,
             document_type = 'offline'
       WHERE id = ${institutionId}
       RETURNING state_code
    `;
    if (rows.length === 0) return { success: false, error: "Institution not found" };
    revalidateInstitutionSurfaces(institutionId, String(rows[0].state_code ?? ""));
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function extractInstitutionCommand(
  institutionId: number,
): Promise<InstitutionCommandResult> {
  const user = await requireAuth("trigger_jobs");
  try {
    validateInstitutionId(institutionId);
    const [institution] = await sql`
      SELECT id, institution_name, state_code, fee_schedule_url
        FROM institution_sources
       WHERE id = ${institutionId}
    `;
    if (!institution) return { success: false, error: "Institution not found" };
    if (!institution.fee_schedule_url) {
      return { success: false, error: "Find a fee URL before extracting this institution" };
    }

    const result = await startAgentRun({
      agent: "magellan",
      kind: "manual_repair",
      title: `Extract fees for ${String(institution.institution_name ?? `institution ${institutionId}`)}`,
      stateCode: institution.state_code ? String(institution.state_code) : undefined,
      params: {
        institution_id: institutionId,
        fee_schedule_url: String(institution.fee_schedule_url),
        source: "admin.institution.extract",
      },
      triggeredBy: user.username,
      triggerSource: "admin",
      idempotencyKey: `institution:${institutionId}:extract`,
      steps: [
        {
          key: "fetch",
          agent: "magellan",
          title: "Fetch the institution fee document",
          input: { institution_id: institutionId },
        },
        {
          key: "read",
          agent: "rosetta",
          title: "Read and normalize the fee document",
        },
        {
          key: "extract",
          agent: "knox",
          title: "Extract fee observations",
        },
        {
          key: "classify",
          agent: "darwin",
          title: "Classify and verify extracted fees",
        },
      ],
      summary: "Agentic institution extraction run accepted. Watch Atlas live status for step events.",
    });
    return { success: true, jobId: result.run.id, reused: result.reused };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function bulkSetInstitutionFeeUrls(
  csvText: string,
): Promise<BulkInstitutionUrlResult> {
  await requireAuth("edit");
  const lines = csvText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("institution_id"));
  const errors: string[] = [];
  const updates: Array<{ id: number; url: string }> = [];

  for (const line of lines) {
    const [rawId, rawUrl] = line.split(/[,\t]/).map((part) => part.trim());
    const id = Number.parseInt(rawId ?? "", 10);
    if (!Number.isInteger(id) || id < 1) {
      errors.push(`Invalid institution ID: ${rawId || "missing"}`);
      continue;
    }
    try {
      updates.push({ id, url: normalizeHttpUrl(rawUrl ?? "") });
    } catch (error) {
      errors.push(`Invalid URL for institution ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (updates.length === 0) {
    return { success: false, updated: 0, errors: errors.length ? errors : ["No valid rows found"] };
  }

  try {
    let updated = 0;
    await withTransaction(async (tx) => {
      for (const item of updates) {
        const rows = await tx`
          UPDATE institution_sources
             SET fee_schedule_url = ${item.url}, document_type = NULL
           WHERE id = ${item.id}
          RETURNING id
        `;
        if (rows.length > 0) await rememberPersonFeeUrl(tx, item.id, item.url);
        if (rows.length > 0) updated += 1;
        else errors.push(`Institution ID ${item.id} not found`);
      }
    });
    revalidatePath("/admin/magellan");
    revalidatePath("/admin/institutions");
    revalidatePath("/admin");
    return { success: true, updated, errors };
  } catch (error) {
    return { success: false, updated: 0, errors: [...errors, error instanceof Error ? error.message : String(error)] };
  }
}
