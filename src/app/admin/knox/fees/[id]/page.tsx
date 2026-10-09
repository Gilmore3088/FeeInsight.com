export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";

export default async function KnoxFeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await params;
  redirect("/admin/knox");
}
