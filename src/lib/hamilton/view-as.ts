/**
 * "View as customer" for admins and analysts. While the cookie is set, Hamilton
 * answers with the Pro prompt a paying customer gets and the Pro nav hides the
 * Admin link, so an admin sees exactly what a customer sees.
 */
export const VIEW_AS_CUSTOMER_COOKIE = "hamilton_view_as_customer";

/** Reads the cookie from a raw Cookie header (API routes) or a cookie value. */
export function isViewAsCustomerCookie(value: string | null | undefined): boolean {
  return value === "1";
}

export function viewAsCustomerFromCookieHeader(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .some((part) => part === `${VIEW_AS_CUSTOMER_COOKIE}=1`);
}
