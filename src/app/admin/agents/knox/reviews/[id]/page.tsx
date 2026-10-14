import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** The Knox decisions queue was retired (James, Oct 9); old links land on Knox. */
export default async function RetiredKnoxDecisionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await params;
  redirect("/admin/knox");
}
