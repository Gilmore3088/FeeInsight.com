import { getCurrentUser } from "@/lib/auth";
import { listPaymentEmails } from "@/lib/data-store/payment-outbox";
import { retryPaymentEmail, resolvePaymentDelivery } from "./payment-delivery-actions";

export default async function PaymentDeliveries() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return null;
  const jobs = await listPaymentEmails().catch(() => null);
  return <section aria-label="Payment delivery recovery" className="admin-card p-4 space-y-3">
    <h2 className="admin-section-title">Payment delivery recovery</h2>
    <p className="text-sm">Accepted means the email provider accepted the message, not that it reached the inbox. Review items require checking provider history before a manual resend.</p>
    {jobs === null ? <p role="alert">Payment delivery history is unavailable. Check the outbox migration and database before claiming delivery is complete.</p>
      : jobs.length === 0 ? <p>No payment delivery records.</p>
      : <ul className="space-y-4">{jobs.map((job) => <li key={job.id} className="border-t pt-3">
        <p className="font-semibold">{job.kind.replaceAll("_", " ")} — {job.state}</p>
        <p className="text-sm">{job.message.to} · {job.attempts} attempt(s) · {job.id}</p>
        {job.provider_id ? <p className="text-xs">Provider receipt: {job.provider_id}</p> : null}
        {job.last_error ? <p className="text-sm" role="status">{job.last_error}</p> : null}
        {job.state === "pending" || job.state === "sending" ? <form action={retryPaymentEmail}>
          <input type="hidden" name="jobId" value={job.id} />
          <button className="underline text-sm" type="submit">Retry when eligible</button>
        </form> : null}
        {job.state === "review" ? <form action={resolvePaymentDelivery} className="mt-2 space-y-2">
          <input type="hidden" name="jobId" value={job.id} />
          <label className="block text-sm">What did you verify or fulfill manually?
            <textarea className="block w-full border rounded p-2" name="note" required minLength={12} maxLength={1000} />
          </label>
          <button className="underline text-sm" type="submit">Record manual resolution — do not resend</button>
        </form> : null}
      </li>)}</ul>}
  </section>;
}
