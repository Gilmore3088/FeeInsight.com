/**
 * Ordinary identity rollout needs a separate reviewed release after the bounded pilot.
 * #2266 blocks it: preserved own LEIs need durable publisher conflict/shared-owner holds.
 * A partition receipt alone is insufficient because a later failure replaces its detail.
 */
export const HMDA_ORDINARY_IDENTITY_WRITES_ENABLED = false;
export const FDIC_OWN_LEI_WRITES_ENABLED = false;
/** Enabling apply/rollback needs separate production authorization and reviewed release. */
export const HMDA_REPAIR_WRITES_ENABLED = false;
