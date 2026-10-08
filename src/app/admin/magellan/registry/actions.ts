"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { sql } from "@/lib/data-store/connection";
import { decideIdentityLink } from "@/lib/agents/magellan/registry/identity";

const decisionSchema = z.object({
  link_type: z.enum(["cfpb_company", "sec_cik"]),
  external_key: z.string().min(1).max(500),
  decision: z.enum(["accepted", "rejected"]),
});

/** Accept or reject one identity match waiting for review on the registry page. */
export async function decideIdentityLinkAction(formData: FormData): Promise<void> {
  const user = await requireAuth("approve");
  const parsed = decisionSchema.safeParse({
    link_type: formData.get("link_type"),
    external_key: formData.get("external_key"),
    decision: formData.get("decision"),
  });
  if (!parsed.success) return;
  await decideIdentityLink(sql, {
    linkType: parsed.data.link_type,
    externalKey: parsed.data.external_key,
    decision: parsed.data.decision,
    verifiedBy: user.username,
  });
  revalidatePath("/admin/magellan/registry");
}
