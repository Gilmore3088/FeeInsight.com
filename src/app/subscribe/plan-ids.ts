/**
 * Element ids the plan board and the page's other pricing buttons share. They live in a plain
 * module, not the "use client" plan board: a server page that imports a constant from a client
 * module gets a client reference, not the string, so its links pointed at nothing.
 */

/** The institution search box the page's pricing buttons land on (pro-tier-chooser.tsx). */
export const CHOOSER_INPUT_ID = "pro_tier_institution";
/** The search and checkout panel, where the sticky phone button and closing card go. */
export const CHECKOUT_ID = "pro-heading";
/** The plan cards; the sticky phone button shows once they scroll away. */
export const PLANS_ID = "pro-plans";
