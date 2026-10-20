"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { withTransaction } from "@/lib/data-store/connection";
import {
  applyIdentityDecision,
  IDENTITY_REVIEW_BULK_LIMIT,
  type IdentityDecision,
  type IdentityDecisionResult,
} from "@/lib/agents/magellan/registry/identity";

/**
 * A person's decisions on registry identity links (CFPB companies, SEC CIKs). These are human
 * decisions, not agent steps: each one is written in a transaction with an audit row in
 * agent_events, and the workers read the result on their next run.
 */

const REVIEW_PAGE = "/admin/magellan/registry/identity";
const blankToUndefined = (value: unknown) => (value === null || value === "" ? undefined : value);
const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const note = z.preprocess(blankToUndefined, z.string().trim().max(1000).optional());
const back = z.preprocess(
  blankToUndefined,
  z.string().regex(/^\/admin\/magellan\/registry\/identity(\?[^\s#]*)?$/).catch(REVIEW_PAGE).default(REVIEW_PAGE),
);

const singleSchema = z.object({
  linkId: id,
  institutionId: z.preprocess(blankToUndefined, id.optional()),
  note,
  back,
});

const bulkSchema = z.object({
  decision: z.enum(["accept", "reject"]),
  linkIds: z.array(id).min(1).max(IDENTITY_REVIEW_BULK_LIMIT),
  note,
  back,
});

function backWith(path: string, message: string): string {
  const url = new URL(path, "http://admin.local");
  url.searchParams.set("msg", message);
  url.searchParams.delete("pick");
  url.searchParams.delete("find");
  return `${url.pathname}${url.search}`;
}

function revalidateDecisions(results: IdentityDecisionResult[]): void {
  revalidatePath(REVIEW_PAGE);
  revalidatePath("/admin/magellan/registry");
  const institutions = new Set<number>();
  for (const result of results) {
    if (result.before.institutionId !== null) institutions.add(result.before.institutionId);
    if (result.after.institutionId !== null) institutions.add(result.after.institutionId);
  }
  for (const institutionId of institutions) {
    revalidatePath(`/institution/${institutionId}`);
    revalidatePath(`/admin/institution/${institutionId}`);
  }
}

const DONE: Record<IdentityDecision, string> = { accept: "Accepted", reject: "Rejected", reset: "Sent back for review" };

async function decide(
  decision: IdentityDecision,
  linkIds: number[],
  options: { institutionId?: number; note?: string; back: string },
): Promise<never> {
  const user = await requireAuth("approve");
  let results: IdentityDecisionResult[] = [];
  let error: string | null = null;
  try {
    results = await withTransaction(async (tx) => {
      const out: IdentityDecisionResult[] = [];
      for (const linkId of linkIds) {
        const result = await applyIdentityDecision(tx, {
          linkId,
          decision,
          institutionId: options.institutionId ?? null,
          note: options.note ?? null,
          reviewer: { id: user.id, username: user.username },
        });
        if (result) out.push(result);
      }
      return out;
    });
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  if (error) redirect(backWith(options.back, `Nothing saved: ${error}`));
  revalidateDecisions(results);
  const missed = linkIds.length - results.length;
  redirect(
    backWith(
      options.back,
      `${DONE[decision]} ${results.length} link${results.length === 1 ? "" : "s"}.${missed > 0 ? ` ${missed} no longer exist.` : ""}`,
    ),
  );
}

async function decideOne(decision: IdentityDecision, formData: FormData): Promise<void> {
  await requireAuth("approve");
  const parsed = singleSchema.safeParse({
    linkId: formData.get("linkId"),
    institutionId: decision === "accept" ? formData.get("institutionId") : null,
    note: formData.get("note"),
    back: formData.get("back"),
  });
  if (!parsed.success) redirect(backWith(REVIEW_PAGE, "Nothing saved: that request was not valid."));
  await decide(decision, [parsed.data.linkId], parsed.data);
}

/** Accept one link, pointing it at institutionId when given (re-point) or at the matcher's guess. */
export async function acceptIdentityLinkAction(formData: FormData): Promise<void> {
  await decideOne("accept", formData);
}

/** Reject one link, with an optional note kept on the link and in the audit row. */
export async function rejectIdentityLinkAction(formData: FormData): Promise<void> {
  await decideOne("reject", formData);
}

/** Clear a person's decision and hand the link back to the matcher as needs_review (undo). */
export async function resetIdentityLinkAction(formData: FormData): Promise<void> {
  await decideOne("reset", formData);
}

/** Accept or reject the ticked links, each at its current institution, up to IDENTITY_REVIEW_BULK_LIMIT at once. */
export async function bulkDecideIdentityLinksAction(formData: FormData): Promise<void> {
  await requireAuth("approve");
  const parsed = bulkSchema.safeParse({
    decision: formData.get("decision"),
    linkIds: formData.getAll("linkId"),
    note: formData.get("note"),
    back: formData.get("back"),
  });
  if (!parsed.success) {
    const count = formData.getAll("linkId").length;
    const message =
      count === 0
        ? "Tick at least one link first."
        : count > IDENTITY_REVIEW_BULK_LIMIT
          ? `Nothing saved: at most ${IDENTITY_REVIEW_BULK_LIMIT} links at once.`
          : "Nothing saved: that request was not valid.";
    redirect(backWith(REVIEW_PAGE, message));
  }
  await decide(parsed.data.decision, parsed.data.linkIds, parsed.data);
}
