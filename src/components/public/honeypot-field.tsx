import { LEAD_HONEYPOT_FIELD } from "@/lib/lead-capture";

/**
 * Hidden from people and assistive tech; bots fill it. /api/leads answers a filled
 * honeypot like a success and stores nothing. Read it with honeypotValue(form).
 */
export function HoneypotField() {
  return (
    <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
      <label>
        Website
        <input type="text" name={LEAD_HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" defaultValue="" />
      </label>
    </div>
  );
}

export function honeypotValue(form: HTMLFormElement): string | undefined {
  const value = new FormData(form).get(LEAD_HONEYPOT_FIELD);
  return typeof value === "string" && value.trim() ? value : undefined;
}
