"use client";
import { useId, useRef, useState } from "react";
import { X, Download } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import { readFirstTouch } from "@/lib/marketing-touch";
import { CTA_PRIMARY } from "@/components/public/site-look";

/** Request, not subscription: contact_* uses the existing durable lead/admin workflow. */
export function LandingLeadAction({ offer, className = CTA_PRIMARY }: { offer: "walkthrough" | "sample"; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const title = offer === "walkthrough" ? "Request a free Hamilton walkthrough" : "Download the sample report";
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError("");
    trackEvent("lead_capture_submit", { placement: "homepage", offer });
    try {
      const response = await fetch("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        source: `contact_${offer}`, name: String(data.get("name") || "").trim() || `${offer === "sample" ? "Sample report" : "Hamilton walkthrough"} requester`,
        email: String(data.get("email") || "").trim(), company: String(data.get("company") || "").trim() || undefined,
        use_case: offer === "sample" ? "Requested existing illustrative sample PDF; placement=homepage; no newsletter opt-in" : `Requested free Hamilton walkthrough; placement=homepage; question=${String(data.get("question") || "")}; no newsletter opt-in`,
        website: String(data.get("website") || ""), firstTouch: readFirstTouch() ?? undefined,
      }) });
      if (!response.ok) { const body=await response.json().catch(()=>({})); throw new Error(body.error || "We could not save your request. Please try again."); }
      setSaved(true); trackEvent("lead_capture_success", { placement: "homepage", offer });
    } catch (e) { setError(e instanceof Error ? e.message : "We could not save your request. Please try again."); trackEvent("lead_capture_error", { placement: "homepage", offer }); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className={className} onClick={() => {dialog.current?.showModal();trackEvent("contact_sales",{placement:"homepage",offer});}}>{offer === "walkthrough" ? "Request a free walkthrough" : "Download sample report"}</button>
    <dialog ref={dialog} aria-labelledby={`${id}-title`} className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-[#E0D7C9] bg-[#FAF7F2] p-6 text-[#1A1815] shadow-xl backdrop:bg-black/40 sm:p-8">
      <div className="flex items-start justify-between gap-4"><h2 id={`${id}-title`} className="text-2xl font-semibold">{title}</h2><button type="button" aria-label="Close request form" onClick={()=>dialog.current?.close()} className="flex h-11 w-11 shrink-0 items-center justify-center"><X size={20} aria-hidden /></button></div>
      {saved ? <div role="status" className="mt-5">
        {offer === "sample" ? <><p>Your request is saved. The sample is ready to download.</p><a className={`${CTA_PRIMARY} mt-5`} download href="/reports/illustrative-competitive-fee-position-2026-10-03.pdf" onClick={()=>trackEvent("see_sample_report",{placement:"homepage",asset:"existing_sample_pdf"})}><Download size={17} aria-hidden />Download sample PDF</a><p className="mt-3 text-xs text-[#6B6255]">Existing illustrative sample. See the dates and scope inside.</p></> : <><p>We’ve received your walkthrough request.</p><p className="mt-2 text-sm text-[#6B6255]">We’ll contact you using the email you provided to arrange the walkthrough and discuss your question.</p></>}
      </div> : <form onSubmit={submit} className="mt-5 space-y-4">
        <p className="text-sm text-[#6B6255]">{offer === "walkthrough" ? "What would you like Hamilton to help your team investigate?" : "Get the existing sample PDF and see the format of a completed fee review."}</p>
        <label className="block text-sm font-medium">Work email<input name="email" type="email" autoComplete="email" required className="mt-1 block min-h-11 w-full rounded-lg border border-[#C4B89F] bg-white px-3" /></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">Name (optional)<input name="name" autoComplete="name" className="mt-1 block min-h-11 w-full rounded-lg border border-[#C4B89F] bg-white px-3" /></label><label className="block text-sm">Institution (optional)<input name="company" autoComplete="organization" className="mt-1 block min-h-11 w-full rounded-lg border border-[#C4B89F] bg-white px-3" /></label></div>
        {offer === "walkthrough" ? <label className="block text-sm">Your research question (optional)<textarea name="question" rows={2} placeholder="How do we compare with local competitors?" className="mt-1 block w-full rounded-lg border border-[#C4B89F] bg-white p-3" /></label> : null}
        <div aria-hidden="true" className="absolute -left-[9999px]"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
        {error ? <p role="alert" className="text-sm text-[#A93D25]">{error}</p> : null}
        <button type="submit" disabled={busy} className={`${CTA_PRIMARY} w-full disabled:opacity-50`}>{busy ? "Saving…" : offer === "sample" ? "Get the sample PDF" : "Request my walkthrough"}</button>
        <p className="text-xs leading-relaxed text-[#6B6255]">We use your email to respond to this request. This form does not sign you up for a newsletter.</p>
      </form>}
    </dialog>
  </>;
}
