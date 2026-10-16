export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { API_ATTRIBUTION, PRODUCT_NAME, SITE_NAME, SITE_URL } from "@/lib/constants";
import { COVERAGE_LABELS, getPublicCategorySummaries, getPublicStatsSummary } from "@/lib/public-stats";
import { API_TIER_LIMITS } from "@/lib/api-rate-limit";
import { getSpotlightCategories } from "@/lib/fee-taxonomy";
import {
  API_ENDPOINTS,
  API_ERRORS,
  COPY,
  RATE_LIMIT_HEADERS,
  coverageStrip,
  curlFor,
  fullPath,
  keyTiers,
  liveFeesSample,
  liveResponseNote,
  responseShape,
} from "./api-docs-view";
import { ApiHero, EndpointList, GetKeyCta, KeysAndLimits, Quickstart } from "./api-docs-sections";

export const metadata: Metadata = {
  title: "API Documentation",
  description: `REST API for the ${PRODUCT_NAME}: published bank and credit union fees, peer benchmarks, institutions and call report revenue, as JSON or CSV. Keys are issued by ${SITE_NAME}.`,
};

export default async function ApiDocsPage() {
  const [summary, categories] = await Promise.all([getPublicStatsSummary(), getPublicCategorySummaries()]);
  const spotlight = getSpotlightCategories();
  const fees = API_ENDPOINTS.find((e) => e.id === "fees");
  const feeFields = fees?.fields ?? [];
  // The free-key response to GET /api/v1/fees, from the same snapshot the route reads.
  const live = liveFeesSample(categories, spotlight, API_ATTRIBUTION);

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "API Docs", href: "/api-docs" },
        ]}
      />
      <ApiHero coverage={coverageStrip(summary, COVERAGE_LABELS)} freshnessLabel={summary.freshnessLabel} />
      <div className="mx-auto max-w-5xl space-y-14 px-4 py-12 sm:px-6">
        <Quickstart
          request={curlFor(SITE_URL, fullPath(fees ?? { path: "/fees" }))}
          response={live ? live.json : responseShape(feeFields)}
          responseLabel={live ? COPY.liveResponseLabel : COPY.shapeResponseLabel}
          responseNote={live ? liveResponseNote(live.total) : undefined}
        />
        <EndpointList endpoints={API_ENDPOINTS} />
        <KeysAndLimits
          tiers={keyTiers({
            spotlightCount: spotlight.length,
            categoriesLabel: summary.categoriesLabel,
            limits: API_TIER_LIMITS,
          })}
          errors={API_ERRORS}
          headers={RATE_LIMIT_HEADERS}
        />
        <GetKeyCta />
      </div>
    </>
  );
}
