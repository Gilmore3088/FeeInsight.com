import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  getArticleBySlug: vi.fn(async () => null),
  incrementViewCount: vi.fn(async () => undefined),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/data-store/articles", () => ({
  getArticleBySlug: mocks.getArticleBySlug,
  getPublishedArticles: vi.fn(async () => []),
  incrementViewCount: mocks.incrementViewCount,
}));
vi.mock("@/lib/data-store/guides", () => ({
  getGuidesForCategory: vi.fn(async () => []),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => null) }));
vi.mock("@/lib/custom-report/sample-report", () => ({
  sampleReportAvailable: vi.fn(async () => false),
}));
vi.mock("@/components/track-link", () => ({
  TrackLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import ArticlePage, { generateMetadata } from "./page";
import ArticleLayout from "./layout";
import { PREVIEW_FIXTURE_SLUG, previewFixtureEnabled } from "./preview-fixture";

const params = Promise.resolve({ slug: PREVIEW_FIXTURE_SLUG });

describe("article template preview fixture", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mocks.after.mockClear();
    mocks.getArticleBySlug.mockClear();
    mocks.notFound.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("is on for Vercel preview and local development only", () => {
    expect(
      previewFixtureEnabled({
        VERCEL_ENV: "preview",
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(previewFixtureEnabled({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(true);
    expect(
      previewFixtureEnabled({
        VERCEL_ENV: "production",
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(previewFixtureEnabled({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("answers notFound in production and never reads the database", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NODE_ENV", "production");
    await expect(ArticleLayout({ children: null, params })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(ArticlePage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await generateMetadata({ params })).toEqual({
      title: "Article Not Found",
    });
    expect(mocks.getArticleBySlug).not.toHaveBeenCalled();
  });

  it("renders the real template on preview, labeled, noindex, with no view count and no database read", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NODE_ENV", "production");
    expect(await ArticleLayout({ children: "ok", params })).toBe("ok");
    render(await ArticlePage({ params }));
    expect(screen.getByRole("note").textContent).toBe("Preview fixture, not published. Figures are placeholders.");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Sample research brief");
    expect(screen.getByRole("button", { name: "Show all 12 rows" })).toBeTruthy();
    expect(document.body.textContent).toContain("Source: Fixture figures for template review. Not Bank Fee Index data.");
    expect(document.body.textContent).not.toContain("Source: Bank Fee Index, from");
    const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((el) => el.textContent ?? "");
    expect(ld.some((text) => text.includes('"@type":"Article"'))).toBe(false);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.getArticleBySlug).not.toHaveBeenCalled();
    const meta = await generateMetadata({ params });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });
});
