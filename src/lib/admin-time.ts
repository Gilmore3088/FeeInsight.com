export const ADMIN_TIME_ZONE = "America/Los_Angeles";

/** Time of day in the admin zone with its label, e.g. "3:04 PM PDT". */
export function formatAdminTime(value: string | null): string {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: ADMIN_TIME_ZONE,
    timeZoneName: "short",
  }).format(new Date(value));
}

export function formatAdminDateTime(
  value: string | null,
  options: { seconds?: boolean } = {},
): string {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(options.seconds ? { second: "2-digit" } : {}),
    timeZone: ADMIN_TIME_ZONE,
    timeZoneName: "short",
  }).format(new Date(value));
}
