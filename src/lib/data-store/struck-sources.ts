/**
 * Sources struck or held under DECISIONS.md "No non-commercial data" (James, 2026-10-17). Rows
 * they loaded before then may still be on prod; no reader returns them.
 *
 * - Struck (loader removed): terms allow only non-commercial, personal or research use, or need
 *   written permission for commercial use.
 * - Held (loader kept, nothing scheduled): terms unconfirmed until James confirms them.
 */
export const STRUCK_AREA_SOURCES: readonly string[] = [
  "kcfed-sb-lending",
  "fed-sbcs",
  "nacha-volume",
  "atlanta-fed-payment-choice",
  "fhlb-advance-rates",
];

/** fed-payments rows read from Federal Reserve Financial Services pages (FedNow, Fed check, the old FedACH page). */
export const STRUCK_SOURCE_URL_PATTERN = "%frbservices.org%";

/** institution_designations values from a struck list: Bank On certified accounts (joinbankon.org). */
export const STRUCK_DESIGNATIONS: readonly string[] = ["bank_on_certified"];

/** state_public_depositories program states whose list was struck: Florida (CFO site terms: educational, personal or training use). */
export const STRUCK_DEPOSITORY_STATES: readonly string[] = ["FL"];

/** FRED series struck: UMCSENT (University of Michigan consumer sentiment; a sold product needs a licence). */
export const STRUCK_FRED_SERIES: readonly string[] = ["UMCSENT"];

/** Held: World Bank Remittance Prices Worldwide (remittance_prices). */
export const HELD_SOURCES: readonly string[] = ["world-bank-remittance-prices"];
