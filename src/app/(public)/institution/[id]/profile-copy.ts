import type { FeePublicationStatus } from "@/lib/institution-quality";
import { PRODUCT_NAME, REPORT_OFFER } from "@/lib/constants";

/** One name, one price, one next step — matches the plan's report offer. */
export const COMPETITIVE_FEE_POSITION_REPORT = {
  name: REPORT_OFFER.name,
  price: REPORT_OFFER.priceLabel,
  nextStep: REPORT_OFFER.nextStep,
} as const;

/** Auto-generated narrative and score bullets are hidden below this many verified fees. */
export const MIN_VERIFIED_FEES_FOR_NARRATIVE = 5;

/** The report offer band and the sidebar Pro card only show once this many fees are verified. */
export const MIN_VERIFIED_FEES_FOR_OFFER = 5;

export const STATUS_COPY: Record<FeePublicationStatus, string> = {
  verified: "Fees come from the institution's own published fee schedule.",
  provisional: "From the published schedule, still in review, so left out of benchmarks for now.",
  under_review: "Its fee schedule is in review. Fees appear here once it clears.",
  unavailable: "We haven't found its published fee schedule yet. Know where it is? Send us the link.",
};

export const METHODOLOGY_COPY = [
  `Only fees that cleared review count in ${PRODUCT_NAME} benchmarks.`,
  "Financial figures come from public FDIC and NCUA call reports.",
] as const;
