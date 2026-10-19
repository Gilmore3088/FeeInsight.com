/**
 * Shared 99.5% target value. The launch measurement is the weekly live batch of 50 whole
 * institutions (DECISIONS, 2026-10-19). The separate automated stored-copy diagnostic uses
 * a sufficient sample and 95% lower-bound gate (#2071); its status cannot satisfy launch sign-off.
 */
export const ACCURACY_TARGET = 0.995;
export const ACCURACY_TARGET_LABEL = "99.5%";
