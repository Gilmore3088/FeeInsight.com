"use server";

import { clearSourceSubmissionCountsCache } from "@/lib/admin-queries";
import { boundedSearchTerm, escapeLikePattern } from "@/lib/api-hardening/query-caps";
import { sql, withTransaction } from "@/lib/data-store/connection";
import { headers } from "next/headers";

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 5; // max submissions per window per IP
const CONTACT_EMAIL_MAX_LENGTH = 254;
const CONTACT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const recentSubmissions = new Map<string, number[]>();

interface SubmitFeeInput {
  institution_id?: number | null;
  institution_name: string;
  source_url: string;
  submitter_role?: string | null;
  notes?: string | null;
  /** Optional work email; stored in notes and event metadata until a dedicated column exists. */
  contact_email?: string | null;
  fees: {
    fee_name: string;
    fee_category: string;
    amount: number | null;
    frequency: string;
  }[];
}

type NormalizedFeeSubmission = SubmitFeeInput["fees"][number] & {
  submission_kind: "fee_row" | "source_intake";
};

interface SubmitResult {
  success: boolean;
  message: string;
  count?: number;
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const timestamps = recentSubmissions.get(ip) || [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    return false;
  }
  recent.push(now);
  recentSubmissions.set(ip, recent);
  return true;
}

async function getSubmissionContextColumnSupport(): Promise<boolean> {
  const rows = await sql<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'community_fee_submissions'
      AND column_name IN ('submitter_role', 'notes', 'submission_kind')
  `;
  const columns = new Set(rows.map((row) => row.column_name));
  return (
    columns.has("submitter_role") &&
    columns.has("notes") &&
    columns.has("submission_kind")
  );
}

async function hasSubmissionEventTable(): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT to_regclass('public.community_fee_submission_events') IS NOT NULL AS exists
  `;
  return rows[0]?.exists === true;
}

export async function submitFees(input: SubmitFeeInput): Promise<SubmitResult> {
  if (!input.institution_name?.trim()) {
    return { success: false, message: "Institution name is required" };
  }
  if (!input.source_url?.trim()) {
    return { success: false, message: "Source URL is required" };
  }
  if (input.fees.length > 20) {
    return { success: false, message: "Maximum 20 fees per submission" };
  }

  try {
    new URL(input.source_url);
  } catch {
    return { success: false, message: "Invalid source URL" };
  }

  const contactEmail = input.contact_email?.trim() || null;
  if (
    contactEmail &&
    (contactEmail.length > CONTACT_EMAIL_MAX_LENGTH || !CONTACT_EMAIL_PATTERN.test(contactEmail))
  ) {
    return { success: false, message: "Please enter a valid work email or leave it blank." };
  }
  const reviewerNotes = [input.notes?.trim() || null, contactEmail ? `Contact email: ${contactEmail}` : null]
    .filter(Boolean)
    .join(" | ") || null;

  const headersList = await headers();
  const ip = headersList.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(ip)) {
    return { success: false, message: "Too many submissions. Please wait a minute." };
  }

  try {
    let targetId = input.institution_id ?? null;
    if (!targetId) {
      const [target] = await sql<{ id: number }[]>`
        SELECT id FROM institution_sources
        WHERE LOWER(institution_name) = LOWER(${input.institution_name.trim()})
        LIMIT 1
      `;
      targetId = target?.id ?? null;
    }

    const normalizedFees: NormalizedFeeSubmission[] =
      input.fees.filter((fee) => fee.fee_name?.trim()).length > 0
        ? input.fees
            .filter((fee) => fee.fee_name?.trim())
            .map((fee) => ({ ...fee, submission_kind: "fee_row" as const }))
        : [
            {
              fee_name: "Official source submitted for review",
              fee_category: "source_intake",
              amount: null,
              frequency: "source_url",
              submission_kind: "source_intake",
            },
          ];
    const supportsContextColumns = await getSubmissionContextColumnSupport().catch(() => false);
    const supportsReviewEvents = await hasSubmissionEventTable().catch(() => false);

    await withTransaction(async (tx) => {
      for (const fee of normalizedFees) {
        if (!fee.fee_name?.trim()) continue;
        let inserted: { id: number }[] = [];
        if (supportsContextColumns) {
          inserted = await tx<{ id: number }[]>`
            INSERT INTO community_fee_submissions
              (institution_id, institution_name, fee_name, fee_category, amount, frequency,
               source_url, submitter_ip, submitter_role, notes, submission_kind)
            VALUES (${targetId}, ${input.institution_name.trim()}, ${fee.fee_name.trim()},
                    ${fee.fee_category || null}, ${fee.amount}, ${fee.frequency || "per_occurrence"},
                    ${input.source_url.trim()}, ${ip}, ${input.submitter_role || null},
                    ${reviewerNotes}, ${fee.submission_kind})
            RETURNING id
          `;
        } else {
          inserted = await tx<{ id: number }[]>`
            INSERT INTO community_fee_submissions
              (institution_id, institution_name, fee_name, fee_category, amount, frequency, source_url, submitter_ip)
            VALUES (${targetId}, ${input.institution_name.trim()}, ${fee.fee_name.trim()},
                    ${fee.fee_category || null}, ${fee.amount}, ${fee.frequency || "per_occurrence"},
                    ${input.source_url.trim()}, ${ip})
            RETURNING id
          `;
        }
        const submissionId = inserted[0]?.id;
        if (supportsReviewEvents && submissionId) {
          await tx`
            INSERT INTO community_fee_submission_events
              (submission_id, event_type, new_status, notes, metadata)
            VALUES
              (${submissionId}, 'submitted', 'pending', ${reviewerNotes},
               ${sql.json({
                 institution_id: targetId,
                 submission_kind: fee.submission_kind,
                 submitter_role: input.submitter_role || null,
                 contact_email: contactEmail,
               })})
          `;
        }
      }
    });

    clearSourceSubmissionCountsCache();

    return {
      success: true,
      message:
        normalizedFees.length === 1 && normalizedFees[0].fee_category === "source_intake"
          ? "Thanks — your source is in review."
          : `Thanks — ${normalizedFees.length} fee(s) are in review.`,
      count: normalizedFees.length,
    };
  } catch (e) {
    console.error("Fee submission error:", e);
    return { success: false, message: "An error occurred. Please try again." };
  }
}

export async function searchInstitutions(query: string): Promise<{ id: number; name: string; state: string | null }[]> {
  // A server action anyone can call: at most 100 characters, at least two letters or digits.
  const term = boundedSearchTerm(query);
  if (!term) return [];

  const escaped = escapeLikePattern(term);
  const rows = await sql`
    SELECT id, institution_name as name, state_code as state
    FROM institution_sources
    WHERE institution_name LIKE ${"%" + escaped + "%"}
    ORDER BY asset_size DESC NULLS LAST
    LIMIT 10
  ` as { id: number; name: string; state: string | null }[];
  return rows;
}
