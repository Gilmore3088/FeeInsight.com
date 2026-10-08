"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { sql } from "@/lib/data-store/connection";
import { decideIdentityLink, type IdentityLinkType } from "@/lib/agents/magellan/registry/identity";

const decisionSchema = z.enum(["accepted", "rejected"]);
const linkSchema = z.string().regex(/^(cfpb_company|sec_cik)\|[^\n]{1,500}$/);

/** Accept or reject the checked identity matches on the registry page in one go. */
export async function decideIdentityLinksAction(formData: FormData): Promise<void> {
  const user = await requireAuth("approve");
  const decision = decisionSchema.safeParse(formData.get("decision"));
  if (!decision.success) return;
  for (const value of formData.getAll("link")) {
    const parsed = linkSchema.safeParse(value);
    if (!parsed.success) continue;
    const split = parsed.data.indexOf("|");
    await decideIdentityLink(sql, {
      linkType: parsed.data.slice(0, split) as IdentityLinkType,
      externalKey: parsed.data.slice(split + 1),
      decision: decision.data,
      verifiedBy: user.username,
    });
  }
  revalidatePath("/admin/magellan/registry");
}
