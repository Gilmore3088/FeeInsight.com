"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { clearSourceSubmissionCountsCache } from "@/lib/admin-queries";
import { getAutomationControl } from "@/lib/automation-control";
import { sql, withTransaction } from "@/lib/data-store/connection";
import { grantInstitutionWorkspaceMembership } from "@/lib/hamilton/institution-membership";
import { recordHamiltonMonitorSignal } from "@/lib/hamilton/monitor-signals";
import { setHamiltonWorkspaceContext } from "@/lib/hamilton/workspace-context";

const idSchema = z.coerce.number().int().positive();
const noteSchema = z.string().trim().max(2_000).optional();

function formId(formData: FormData): number | null {
  const parsed = idSchema.safeParse(formData.get("submission_id"));
  return parsed.success ? parsed.data : null;
}

function formClaimId(formData: FormData): number | null {
  const parsed = idSchema.safeParse(formData.get("claim_id"));
  return parsed.success ? parsed.data : null;
}

function formNotes(formData: FormData): string | null {
  const value = formData.get("review_notes");
  const parsed = noteSchema.safeParse(typeof value === "string" ? value : undefined);
  if (!parsed.success) return null;
  return parsed.data?.trim() || null;
}

function refreshTrustPaths(institutionId: number | null): void {
  clearSourceSubmissionCountsCache();
  revalidatePath("/admin");
  revalidatePath("/admin/quality");
  revalidatePath("/admin/data-quality");
  if (institutionId) {
    revalidatePath(`/admin/institution/${institutionId}`);
    revalidatePath(`/institution/${institutionId}`);
  }
}

function readableStatus(value: string): string {
  return value.replaceAll("_", " ");
}

function isReviewableStatus(status: string): boolean {
  return status === "pending" || status === "needs_info";
}

async function submissionExists(id: number) {
  const rows = await sql<{
    id: number;
    institution_id: number | null;
    institution_name: string;
    source_url: string;
    review_status: string;
  }[]>`
    SELECT id, institution_id, institution_name, source_url, review_status
    FROM community_fee_submissions
    WHERE id = ${id}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function claimExists(id: number) {
  const rows = await sql<{
    id: number;
    institution_id: number;
    institution_name: string | null;
    claimant_user_id: number;
    review_status: string;
  }[]>`
    SELECT
      claim.id,
      claim.institution_id,
      inst.institution_name,
      claim.claimant_user_id,
      claim.review_status
    FROM institution_claims claim
    LEFT JOIN institution_sources inst ON inst.id = claim.institution_id
    WHERE claim.id = ${id}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

function claimInstitutionLabel(claim: Awaited<ReturnType<typeof claimExists>>): string {
  if (!claim) return "Institution";
  return claim.institution_name?.trim() || `Institution ${claim.institution_id}`;
}

export async function acceptSourceSubmission(formData: FormData): Promise<void> {
  const user = await requireAuth("approve");
  const id = formId(formData);
  if (!id) return;
  const notes = formNotes(formData);
  const automation = await getAutomationControl().catch(() => null);
  const resolution = automation?.enabled
    ? "manual_validation_needed"
    : "ready_for_validation_when_automation_resumes";
  const queueStatus = automation?.enabled
    ? "manual_validation_needed"
    : "ready_when_automation_resumes";
  const validationMode = automation?.enabled ? "automation_guarded" : "manual";

  try {
    const submission = await submissionExists(id);
    if (!submission) return;
    if (!isReviewableStatus(submission.review_status)) return;

    await withTransaction(async (tx) => {
      await tx`
        UPDATE community_fee_submissions
        SET review_status = 'accepted',
            reviewed_at = NOW(),
            reviewer_id = ${user.id},
            review_notes = ${notes},
            resolution = ${resolution},
            source_document_id = NULL,
            agent_run_id = NULL
        WHERE id = ${id}
      `;

      if (submission.institution_id) {
        await tx`
          UPDATE institution_sources
          SET fee_schedule_url = ${submission.source_url}
          WHERE id = ${submission.institution_id}
            AND (
              fee_schedule_url IS NULL
              OR btrim(fee_schedule_url) = ''
              OR fee_schedule_url <> ${submission.source_url}
            )
        `;

        await tx`
          INSERT INTO source_validation_queue
            (institution_id, submission_id, source_url, queue_status, validation_mode,
             created_by_user_id, notes)
          VALUES
            (${submission.institution_id}, ${id}, ${submission.source_url}, ${queueStatus},
             ${validationMode}, ${user.id}, ${notes})
          ON CONFLICT (submission_id)
          WHERE submission_id IS NOT NULL
          DO UPDATE SET
            source_url = EXCLUDED.source_url,
            queue_status = EXCLUDED.queue_status,
            validation_mode = EXCLUDED.validation_mode,
            created_by_user_id = EXCLUDED.created_by_user_id,
            notes = EXCLUDED.notes,
            updated_at = NOW()
        `;
      }

      await tx`
        INSERT INTO community_fee_submission_events
          (submission_id, actor_user_id, event_type, previous_status, new_status, notes, metadata)
        VALUES
          (${id}, ${user.id}, 'accepted', ${submission.review_status}, 'accepted', ${notes},
           ${sql.json({
             resolution,
             automation_enabled: automation?.enabled ?? false,
             institution_id: submission.institution_id,
             validation_queue_status: submission.institution_id ? queueStatus : null,
             provider_call_queued: false,
           })})
      `;

      if (submission.institution_id) {
        await recordHamiltonMonitorSignal(
          {
            institutionId: submission.institution_id,
            signalType: "source_accepted",
            severity: "medium",
            title: `${submission.institution_name} - official fee source accepted`,
            body:
              `Data Trust accepted an official fee source URL. Validation is ${readableStatus(queueStatus)}; ` +
              "rerun analysis or reports after verified rows publish.",
            sourceJson: {
              source: "community_fee_submission",
              submission_id: id,
              previous_status: submission.review_status,
              new_status: "accepted",
              resolution,
              validation_queue_status: queueStatus,
              validation_mode: validationMode,
              provider_call_queued: false,
            },
          },
          tx,
        );
      }
    });

    refreshTrustPaths(submission.institution_id);
  } catch (e) {
    console.error("acceptSourceSubmission failed:", e);
  }
}

export async function rejectSourceSubmission(formData: FormData): Promise<void> {
  const user = await requireAuth("approve");
  const id = formId(formData);
  if (!id) return;
  const notes = formNotes(formData);

  try {
    const submission = await submissionExists(id);
    if (!submission) return;
    if (!isReviewableStatus(submission.review_status)) return;

    await withTransaction(async (tx) => {
      await tx`
        UPDATE community_fee_submissions
        SET review_status = 'rejected',
            reviewed_at = NOW(),
            reviewer_id = ${user.id},
            review_notes = ${notes},
            resolution = 'rejected_not_official',
            source_document_id = NULL,
            agent_run_id = NULL
        WHERE id = ${id}
      `;
      await tx`
        INSERT INTO community_fee_submission_events
          (submission_id, actor_user_id, event_type, previous_status, new_status, notes, metadata)
        VALUES
          (${id}, ${user.id}, 'rejected', ${submission.review_status}, 'rejected', ${notes},
           ${sql.json({ institution_id: submission.institution_id })})
      `;
      if (submission.institution_id) {
        await recordHamiltonMonitorSignal(
          {
            institutionId: submission.institution_id,
            signalType: "source_rejected",
            severity: "low",
            title: `${submission.institution_name} - submitted source rejected`,
            body:
              "Data Trust rejected the submitted source as not official enough for validation. " +
              "Submit a better source before relying on institution-specific fee analysis.",
            sourceJson: {
              source: "community_fee_submission",
              submission_id: id,
              previous_status: submission.review_status,
              new_status: "rejected",
              resolution: "rejected_not_official",
            },
          },
          tx,
        );
      }
    });

    refreshTrustPaths(submission.institution_id);
  } catch (e) {
    console.error("rejectSourceSubmission failed:", e);
  }
}

export async function requestSourceSubmissionInfo(formData: FormData): Promise<void> {
  const user = await requireAuth("approve");
  const id = formId(formData);
  if (!id) return;
  const notes = formNotes(formData);

  try {
    const submission = await submissionExists(id);
    if (!submission) return;
    if (!isReviewableStatus(submission.review_status)) return;

    await withTransaction(async (tx) => {
      await tx`
        UPDATE community_fee_submissions
        SET review_status = 'needs_info',
            reviewed_at = NOW(),
            reviewer_id = ${user.id},
            review_notes = ${notes},
            resolution = 'needs_more_context'
        WHERE id = ${id}
      `;
      await tx`
        INSERT INTO community_fee_submission_events
          (submission_id, actor_user_id, event_type, previous_status, new_status, notes, metadata)
        VALUES
          (${id}, ${user.id}, 'needs_info', ${submission.review_status}, 'needs_info', ${notes},
           ${sql.json({ institution_id: submission.institution_id })})
      `;
      if (submission.institution_id) {
        await recordHamiltonMonitorSignal(
          {
            institutionId: submission.institution_id,
            signalType: "source_needs_info",
            severity: "medium",
            title: `${submission.institution_name} - source needs more information`,
            body:
              "Data Trust requested more context before validating the submitted source. " +
              "Institution-specific conclusions should remain caveated until the source is accepted.",
            sourceJson: {
              source: "community_fee_submission",
              submission_id: id,
              previous_status: submission.review_status,
              new_status: "needs_info",
              resolution: "needs_more_context",
            },
          },
          tx,
        );
      }
    });

    refreshTrustPaths(submission.institution_id);
  } catch (e) {
    console.error("requestSourceSubmissionInfo failed:", e);
  }
}

export async function acceptInstitutionClaim(formData: FormData): Promise<void> {
  const user = await requireAuth("approve");
  const id = formClaimId(formData);
  if (!id) return;
  const notes = formNotes(formData);

  try {
    const claim = await claimExists(id);
    if (!claim) return;
    if (!isReviewableStatus(claim.review_status)) return;
    const institutionLabel = claimInstitutionLabel(claim);

    await withTransaction(async (tx) => {
      await tx`
        UPDATE institution_claims
        SET review_status = 'accepted',
            reviewed_at = NOW(),
            reviewer_id = ${user.id},
            review_notes = ${notes},
            resolution = 'verified_claim',
            updated_at = NOW()
        WHERE id = ${id}
      `;
      await tx`
        INSERT INTO institution_claim_events
          (claim_id, actor_user_id, event_type, previous_status, new_status, notes, metadata)
        VALUES
          (${id}, ${user.id}, 'accepted', ${claim.review_status}, 'accepted', ${notes},
           ${sql.json({
             institution_id: claim.institution_id,
             claimant_user_id: claim.claimant_user_id,
             membership_role: "owner",
             membership_status: "active",
           })})
      `;
      await grantInstitutionWorkspaceMembership(
        {
          institutionId: claim.institution_id,
          userId: claim.claimant_user_id,
          role: "owner",
          source: "claim",
          claimId: claim.id,
          grantedByUserId: user.id,
          notes,
        },
        tx,
      );
      await recordHamiltonMonitorSignal(
        {
          institutionId: claim.institution_id,
          signalType: "claim_accepted",
          severity: "high",
          title: `${institutionLabel} - institution claim accepted`,
          body:
            "Data Trust accepted the institution claim. Workspace authority is active for the claimant; " +
            "use Hamilton Settings to manage context, sources, and follow-on analysis.",
          priorityAlertUserId: claim.claimant_user_id,
          sourceJson: {
            source: "institution_claim",
            claim_id: claim.id,
            claimant_user_id: claim.claimant_user_id,
            previous_status: claim.review_status,
            new_status: "accepted",
            membership_role: "owner",
          },
        },
        tx,
      );
    });

    await setHamiltonWorkspaceContext({
      userId: claim.claimant_user_id,
      institutionId: claim.institution_id,
      source: "profile",
      intent: "claim-accepted",
    }).catch(() => {});

    refreshTrustPaths(claim.institution_id);
    revalidatePath("/account");
    revalidatePath("/pro");
    revalidatePath("/pro/settings");
  } catch (e) {
    console.error("acceptInstitutionClaim failed:", e);
  }
}

export async function rejectInstitutionClaim(formData: FormData): Promise<void> {
  const user = await requireAuth("approve");
  const id = formClaimId(formData);
  if (!id) return;
  const notes = formNotes(formData);

  try {
    const claim = await claimExists(id);
    if (!claim) return;
    if (!isReviewableStatus(claim.review_status)) return;
    const institutionLabel = claimInstitutionLabel(claim);

    await withTransaction(async (tx) => {
      await tx`
        UPDATE institution_claims
        SET review_status = 'rejected',
            reviewed_at = NOW(),
            reviewer_id = ${user.id},
            review_notes = ${notes},
            resolution = 'rejected_not_authorized',
            updated_at = NOW()
        WHERE id = ${id}
      `;
      // A Pro buyer holds the owner seat from checkout while the claim is open; rejecting it ends that seat.
      await tx`
        UPDATE institution_workspace_memberships
           SET membership_status = 'revoked', revoked_by_user_id = ${user.id}, revoked_at = NOW(), updated_at = NOW()
         WHERE claim_id = ${id} AND membership_status = 'active'
      `;
      await tx`
        INSERT INTO institution_claim_events
          (claim_id, actor_user_id, event_type, previous_status, new_status, notes, metadata)
        VALUES
          (${id}, ${user.id}, 'rejected', ${claim.review_status}, 'rejected', ${notes},
           ${sql.json({
             institution_id: claim.institution_id,
             claimant_user_id: claim.claimant_user_id,
           })})
      `;
      await recordHamiltonMonitorSignal(
        {
          institutionId: claim.institution_id,
          signalType: "claim_rejected",
          severity: "low",
          title: `${institutionLabel} - institution claim rejected`,
          body:
            "Data Trust rejected the institution claim. The claimant does not have workspace authority for this institution.",
          priorityAlertUserId: claim.claimant_user_id,
          sourceJson: {
            source: "institution_claim",
            claim_id: claim.id,
            claimant_user_id: claim.claimant_user_id,
            previous_status: claim.review_status,
            new_status: "rejected",
            resolution: "rejected_not_authorized",
          },
        },
        tx,
      );
    });

    refreshTrustPaths(claim.institution_id);
    revalidatePath("/pro/settings");
  } catch (e) {
    console.error("rejectInstitutionClaim failed:", e);
  }
}

export async function requestInstitutionClaimInfo(formData: FormData): Promise<void> {
  const user = await requireAuth("approve");
  const id = formClaimId(formData);
  if (!id) return;
  const notes = formNotes(formData);

  try {
    const claim = await claimExists(id);
    if (!claim) return;
    if (!isReviewableStatus(claim.review_status)) return;
    const institutionLabel = claimInstitutionLabel(claim);

    await withTransaction(async (tx) => {
      await tx`
        UPDATE institution_claims
        SET review_status = 'needs_info',
            reviewed_at = NOW(),
            reviewer_id = ${user.id},
            review_notes = ${notes},
            resolution = 'needs_more_context',
            updated_at = NOW()
        WHERE id = ${id}
      `;
      await tx`
        INSERT INTO institution_claim_events
          (claim_id, actor_user_id, event_type, previous_status, new_status, notes, metadata)
        VALUES
          (${id}, ${user.id}, 'needs_info', ${claim.review_status}, 'needs_info', ${notes},
           ${sql.json({
             institution_id: claim.institution_id,
             claimant_user_id: claim.claimant_user_id,
           })})
      `;
      await recordHamiltonMonitorSignal(
        {
          institutionId: claim.institution_id,
          signalType: "claim_needs_info",
          severity: "medium",
          title: `${institutionLabel} - institution claim needs more information`,
          body:
            "Data Trust requested more context before granting institution workspace authority. " +
            "The claimant should update claim notes or submit supporting source evidence.",
          priorityAlertUserId: claim.claimant_user_id,
          sourceJson: {
            source: "institution_claim",
            claim_id: claim.id,
            claimant_user_id: claim.claimant_user_id,
            previous_status: claim.review_status,
            new_status: "needs_info",
            resolution: "needs_more_context",
          },
        },
        tx,
      );
    });

    refreshTrustPaths(claim.institution_id);
    revalidatePath("/pro/settings");
  } catch (e) {
    console.error("requestInstitutionClaimInfo failed:", e);
  }
}
