const WELCOME_PATH = "/account/welcome";

/**
 * After checkout, send a paying user back to wherever they started — a Pro screen, an
 * invite, or the institution profile whose Pro card sent them to pricing. Only the welcome
 * page itself is not a destination. `destination` must already be sanitized.
 */
export function shouldResumeAfterCheckout(destination: string | null): destination is string {
  if (!destination || !destination.startsWith("/")) return false;
  return destination !== WELCOME_PATH && !destination.startsWith(`${WELCOME_PATH}?`) && !destination.startsWith(`${WELCOME_PATH}/`);
}
