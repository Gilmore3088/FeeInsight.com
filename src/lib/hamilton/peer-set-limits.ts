/**
 * The size limit of a saved Hamilton peer group, with no imports, so the public peer explorer's
 * link builder and Hamilton's settings form and save action share one number (#1997). The API's
 * `MAX_CHOSEN_PEERS` (src/lib/peer-set-dimensions.ts) is a different, smaller limit.
 */
export const MAX_SAVED_PEER_SET_INSTITUTIONS = 50;
