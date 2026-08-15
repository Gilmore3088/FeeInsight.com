"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import {
  approveGuideRegulatoryContent,
  getGuideBySlug,
  publishGuide,
  setGuideStatus,
} from "@/lib/data-store/guides";

/**
 * Guide review actions.
 *
 * Publishing is deliberately not reachable in one step for a guide carrying regulatory
 * content. The status machine is draft -> in_review -> regulatory_review -> published,
 * and the database refuses a published regulatory guide with no approval recorded, so
 * a bug here fails loudly instead of putting an unreviewed Reg E claim in front of a
 * consumer.
 */

export interface GuideActionResult {
  success: boolean;
  error?: string;
}

function refresh(slug?: string): void {
  revalidatePath("/admin/hamilton/guides");
  revalidatePath("/guides");
  if (slug) revalidatePath(`/guides/${slug}`);
}

export async function moveGuideToReviewAction(
  guideId: number,
): Promise<GuideActionResult> {
  await requireAuth("edit");
  await setGuideStatus(guideId, "in_review");
  refresh();
  return { success: true };
}

export async function moveGuideToRegulatoryReviewAction(
  guideId: number,
): Promise<GuideActionResult> {
  await requireAuth("edit");
  await setGuideStatus(guideId, "regulatory_review");
  refresh();
  return { success: true };
}

/**
 * Record a regulatory sign-off against the guide's current text.
 *
 * The approver is taken from the session, never from the form — an approval has to name
 * a real person for the record to mean anything.
 */
export async function approveGuideRegulatoryAction(
  guideId: number,
): Promise<GuideActionResult> {
  const user = await requireAuth("edit");
  const approver = user.email || user.username || `user:${user.id}`;
  const approved = await approveGuideRegulatoryContent(guideId, approver);
  if (!approved) return { success: false, error: "Guide not found" };
  refresh(approved.slug);
  return { success: true };
}

export async function publishGuideAction(
  guideId: number,
  changeNote?: string,
): Promise<GuideActionResult> {
  const user = await requireAuth("edit");
  const actor = user.email || user.username || `user:${user.id}`;

  try {
    const published = await publishGuide(guideId, actor, changeNote);
    if (!published) return { success: false, error: "Guide not found" };
    refresh(published.slug);
    return { success: true };
  } catch (error) {
    // The regulatory gate is a database constraint, so this is the expected failure
    // when someone tries to publish an unapproved regulatory guide.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("consumer_guides_regulatory_gate_check")) {
      return {
        success: false,
        error:
          "This guide states regulatory facts and has not been approved. Record an approval before publishing.",
      };
    }
    if (message.includes("consumer_guides_consumer_is_public_check")) {
      return {
        success: false,
        error: "Consumer guides must stay on the public tier.",
      };
    }
    if (message.includes("consumer_guides_published_metadata_check")) {
      return {
        success: false,
        error: "A published guide needs a review date. Save the guide again first.",
      };
    }
    return { success: false, error: message };
  }
}

export async function archiveGuideAction(guideId: number): Promise<GuideActionResult> {
  await requireAuth("edit");
  await setGuideStatus(guideId, "archived" as never);
  refresh();
  return { success: true };
}

/** Preview what a reader would see — used to surface unresolved tokens before publish. */
export async function loadGuideForPreviewAction(slug: string) {
  await requireAuth("view");
  return getGuideBySlug(slug, { includeUnpublished: true });
}
