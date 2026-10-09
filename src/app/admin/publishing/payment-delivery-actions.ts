"use server";
import { getCurrentUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { drainPaymentEmails } from "@/lib/billing/payment-delivery";
import { resolvePaymentEmail } from "@/lib/data-store/payment-outbox";

async function admin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") throw new Error("Administrator access required");
  return user;
}
function jobId(form: FormData): string {
  const id = String(form.get("jobId") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("Invalid delivery id");
  return id;
}
export async function retryPaymentEmail(form: FormData): Promise<void> {
  await admin();
  // Does not override leases, retry timing, review state, or the 23-hour safety cutoff.
  await drainPaymentEmails(null, jobId(form));
  revalidatePath("/admin/publishing");
}
export async function resolvePaymentDelivery(form: FormData): Promise<void> {
  const user = await admin();
  await resolvePaymentEmail(jobId(form), user.id, String(form.get("note") ?? ""));
  revalidatePath("/admin/publishing");
}
