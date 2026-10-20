import { PRODUCT_NAME, SITE_DOMAIN, SITE_NAME } from "@/lib/constants";

export interface BrandConfig {
  name: string;
  tagline: string;
  url: string;
  primaryColor: string;
  accentColor: string;
  logoSvg: string;
}

/** The one Fee Insight mark: three terracotta bars (same geometry as customer-nav). */
const FEE_INSIGHT_LOGO = `<svg viewBox="0 0 24 24" fill="none" stroke="#C44B2E" stroke-width="1.5" width="28" height="28" aria-hidden="true"><rect x="4" y="13" width="4" height="8" rx="1"/><rect x="10" y="8" width="4" height="13" rx="1"/><rect x="16" y="3" width="4" height="18" rx="1"/></svg>`;

const DEFAULT_BRAND_ID = "fee-insight";

export const BRANDS: Record<string, BrandConfig> = {
  [DEFAULT_BRAND_ID]: {
    name: SITE_NAME,
    tagline: `Home of the ${PRODUCT_NAME}`,
    url: SITE_DOMAIN,
    primaryColor: "#1A1815",
    accentColor: "#C44B2E",
    logoSvg: FEE_INSIGHT_LOGO,
  },
};

export function getBrand(id?: string): BrandConfig {
  return BRANDS[id || DEFAULT_BRAND_ID] || BRANDS[DEFAULT_BRAND_ID];
}
