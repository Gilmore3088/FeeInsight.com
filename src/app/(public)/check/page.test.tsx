import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SITE_URL } from "@/lib/constants";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { PageHero } from "@/components/public/page-hero";
import { CHECK_DESCRIPTION, CHECK_TITLE, CHECK_URL, CheckJsonLd } from "./check-jsonld";
import { getComparableMarketIndexCached } from "@/lib/data-store/public-cached-reads";
import { getPublicInstitutionForPage, getVisibleFeesForPage, isVerifiedFee } from "../institution/[id]/profile-data";

vi.mock("@/app/landing-serif", () => ({ homeSerif: { variable: "serif-var" } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => null) }));
vi.mock("@/lib/data-store/alerts", () => ({ getAlertSubscriptionForInstitution: vi.fn() }));
vi.mock("@/lib/data-store/public-cached-reads", () => ({
  getBranchCityForZipCached: vi.fn(),
  getCityMarketCached: vi.fn(),
  getComparableMarketIndexCached: vi.fn(async () => []),
  searchInstitutionsCached: vi.fn(),
}));
vi.mock("@/lib/public-stats", () => ({
  UNAVAILABLE_LABEL: "Unavailable",
  formatAbsoluteDate: vi.fn(),
  getPublicStatsSummary: vi.fn(async () => ({ institutionsLabel: "Unavailable", refreshedOn: null })),
}));
vi.mock("@/lib/custom-report/sample-report", () => ({ sampleReportAvailable: vi.fn(async () => false) }));
vi.mock("../consumer/check-example", () => ({ CheckExample: () => null, loadCheckExample: vi.fn(async () => null) }));
vi.mock("../institutions/search-bar", () => ({ InstitutionSearchBar: () => null }));
vi.mock("../institution/[id]/fee-alert-control", () => ({ FeeAlertControl: () => null }));
vi.mock("../institution/[id]/profile-data", () => ({
  getPublicInstitutionForPage: vi.fn(),
  getVisibleFeesForPage: vi.fn(),
  isVerifiedFee: vi.fn(),
  pickHeadlineValues: vi.fn(() => []),
}));
vi.mock("@/lib/guides/source", () => ({ loadConsumerGuides: vi.fn(async () => []) }));

import CheckPage, { generateMetadata } from "./page";

function findElement(node: ReactNode, component: unknown): ReactElement | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode }>(child)) continue;
    if (child.type === component) return child;
    const nested = findElement(child.props.children, component);
    if (nested) return nested;
  }
}

function parseScript(element: ReactElement) {
  const document = new DOMParser().parseFromString(renderToStaticMarkup(element), "text/html");
  return JSON.parse(document.querySelector('script[type="application/ld+json"]')?.textContent ?? "");
}

function findAnswer(node: ReactNode): ReactElement<{ id: number; near: string; refreshedOn: string | null }> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode }>(child)) continue;
    if (typeof child.type === "function" && child.type.name === "CheckAnswer") return child as ReturnType<typeof findAnswer>;
    const nested = findAnswer(child.props.children);
    if (nested) return nested;
  }
}

describe("Fee Check page schema", () => {
  it("describes the free browser tool without inventing ratings, offers or fee results", () => {
    const schema = parseScript(<CheckJsonLd />);
    expect(schema).toMatchObject({
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": `${CHECK_URL}#webpage`,
      url: CHECK_URL,
      name: CHECK_TITLE,
      description: CHECK_DESCRIPTION,
      inLanguage: "en",
      isAccessibleForFree: true,
      mainEntity: {
        "@type": "WebApplication",
        "@id": `${CHECK_URL}#application`,
        name: "Fee Check",
        url: CHECK_URL,
        isAccessibleForFree: true,
        applicationCategory: "FinanceApplication",
        audience: { "@type": "Audience", audienceType: "Consumers" },
      },
    });
    expect(JSON.stringify(schema)).not.toMatch(/aggregateRating|review|offers|price|median_amount|institution_id|\?id=|\?q=/);
  });

  it.each([{}, { id: "323" }, { id: "unknown" }, { q: "Bank" }])(
    "keeps canonical tool schema and consumer navigation for input %j",
    async (params) => {
      const searchParams = Promise.resolve(params);
      const metadata = await generateMetadata({ searchParams });
      const page = await CheckPage({ searchParams });
      const script = findElement(page, CheckJsonLd);
      expect(script).toBeDefined();
      expect(parseScript(script!)).toEqual(parseScript(<CheckJsonLd />));
      expect(metadata.alternates?.canonical).toBe(CHECK_URL);
      expect(metadata.title).toBe(CHECK_TITLE);
      expect(metadata.description).toBe(CHECK_DESCRIPTION);
      expect(metadata.robots).toEqual("id" in params || "q" in params ? { index: false, follow: true } : undefined);
      const breadcrumbs = parseScript(findElement(page, BreadcrumbJsonLd)!);
      expect(breadcrumbs.itemListElement.map((item: { item: string }) => item.item))
        .toEqual([`${SITE_URL}/`, `${SITE_URL}/for-consumers`, CHECK_URL]);
      const hero = findElement(page, PageHero) as ReactElement<{ crumbs: ReactNode }>;
      const navigation = new DOMParser().parseFromString(renderToStaticMarkup(<>{hero.props.crumbs}</>), "text/html");
      expect(navigation.querySelector('a[href="/for-consumers"]')?.textContent).toBe("For consumers");
    },
  );

  it("compares an institution against the same eligible U.S. and state populations as its profile", async () => {
    vi.mocked(getPublicInstitutionForPage).mockResolvedValue({
      id: 323,
      institution_name: "Example Bank",
      fee_count: 1,
      state_code: "FL",
    } as Awaited<ReturnType<typeof getPublicInstitutionForPage>>);
    vi.mocked(getVisibleFeesForPage).mockResolvedValue([{
      id: 1,
      institution_id: 323,
      fee_name: "Overdraft fee",
      fee_category: "overdraft",
      fee_audience: "consumer",
      amount: 30,
      review_status: "approved",
    } as Awaited<ReturnType<typeof getVisibleFeesForPage>>[number]]);
    vi.mocked(isVerifiedFee).mockReturnValue(true);
    vi.mocked(getComparableMarketIndexCached).mockClear();
    const page = await CheckPage({ searchParams: Promise.resolve({ id: "323" }) });
    const answer = findAnswer(page)!;
    await (answer.type as (props: typeof answer.props) => Promise<ReactElement>)(answer.props);
    expect(getComparableMarketIndexCached).toHaveBeenCalledWith({ kind: "us" });
    expect(getComparableMarketIndexCached).toHaveBeenCalledWith({ kind: "state", code: "FL" });
  });

  it("gives an empty verified-fee result an accurate message and institution-aware source intake", async () => {
    vi.mocked(getPublicInstitutionForPage).mockResolvedValue({
      id: 857,
      institution_name: "Example & Trust",
      fee_count: 3,
      published_fee_count: 3,
      state_code: "IN",
    } as Awaited<ReturnType<typeof getPublicInstitutionForPage>>);
    vi.mocked(getVisibleFeesForPage).mockResolvedValue([]);
    const page = await CheckPage({ searchParams: Promise.resolve({ id: "857" }) });
    const answer = findAnswer(page)!;
    const result = await (answer.type as (props: typeof answer.props) => Promise<ReactElement>)(answer.props);
    const document = new DOMParser().parseFromString(renderToStaticMarkup(result), "text/html");
    expect(document.body.textContent).toContain("No verified consumer fees are available to compare for Example & Trust yet.");
    expect(document.body.textContent).not.toContain("has not published fees");
    const intake = [...document.querySelectorAll("a")].find((link) => link.textContent?.trim() === "Send a fee schedule");
    expect(intake).toBeDefined();
    const intakeUrl = new URL(intake!.getAttribute("href")!, SITE_URL);
    expect(intakeUrl.pathname).toBe("/submit-fees");
    expect(intakeUrl.searchParams.get("institutionId")).toBe("857");
    expect(intakeUrl.searchParams.get("institutionName")).toBe("Example & Trust");
  });
});
