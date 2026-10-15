export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { after } from "next/server";
import Link from "next/link";
import { getArticleBySlug, incrementViewCount, getPublishedArticles, type Article } from "@/lib/data-store/articles";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { TrackLink } from "@/components/track-link";
import { DEMO_REQUEST_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { PRODUCT_NAME, REPORT_OFFER, REPORT_PRICE_INLINE, SITE_NAME, SITE_URL } from "@/lib/constants";
import { linkPreview } from "@/lib/link-preview";
import { renderArticleMarkdown } from "@/lib/article-markdown";
import { plainSummary, readingMinutes, splitLeadChart } from "./article-view";

/** The published article, or null when it is missing or unpublished. A failed read still errors (500), never a 404. */
const loadArticle = cache(async (slug: string): Promise<Article | null> => {
  const article = await getArticleBySlug(slug);
  return article && article.status === "published" ? article : null;
});

/** The product name is not an author; the site names the byline (brand rule). */
function byline(author: string | null | undefined): string {
  return !author || author === PRODUCT_NAME ? SITE_NAME : author;
}

function isoDate(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = await loadArticle(slug);
  if (!article) {
    return { title: "Article Not Found" };
  }
  const title = `${article.title} | Research`;
  const description = article.subtitle || plainSummary(splitLeadChart(article.content).body);
  const path = `/research/articles/${article.slug}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    ...linkPreview({ title: article.title, description, path }),
  };
}

const LINK = "font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink";

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = await loadArticle(slug);
  if (!article) notFound();

  // Counted after the response is sent, so a slow write never holds the page.
  after(() => incrementViewCount(slug).catch(() => undefined));

  const relatedArticles = (await getPublishedArticles(4).catch(() => [] as Article[])).filter((a) => a.slug !== slug).slice(0, 3);
  const { lead, body } = splitLeadChart(article.content);
  const minutes = readingMinutes(article.content);

  const publishedDate = article.published_at
    ? new Date(article.published_at).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Research", href: "/research" },
          { name: article.title, href: `/research/articles/${slug}` },
        ]}
      />

      <section className="border-b border-border bg-paper">
        <div
          className={`mx-auto grid max-w-page gap-8 px-4 pb-10 pt-6 sm:px-6 sm:pt-10 ${lead ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-center lg:gap-12" : ""}`}
        >
          <div className="max-w-3xl">
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[12px] text-ink-muted">
              <Link href="/research" className="hover:text-ink">
                Research
              </Link>
              <span aria-hidden="true">/</span>
              <span className="capitalize text-ink-soft">{article.category}</span>
            </nav>
            <h1 className="mt-4 text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-[44px]">{article.title}</h1>
            {article.subtitle && <p className="mt-3 text-[17px] text-ink-soft">{article.subtitle}</p>}
            <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-muted">
              <span>{byline(article.author)}</span>
              {publishedDate && (
                <>
                  <span aria-hidden="true">·</span>
                  <time dateTime={isoDate(article.published_at)}>{publishedDate}</time>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>{minutes} min read</span>
            </p>
          </div>
          {lead && (
            <div className="rounded-2xl border border-border bg-surface-0 p-5 shadow-fi-2 sm:p-6">
              <div dangerouslySetInnerHTML={{ __html: renderArticleMarkdown(lead) }} />
              <p className="mt-2 text-[11px] text-ink-muted">
                Source: {PRODUCT_NAME}, from institutions&apos; own published fee schedules.{publishedDate ? ` As of ${publishedDate}.` : ""}
              </p>
            </div>
          )}
        </div>
      </section>

      <div className="mx-auto grid max-w-page gap-12 px-4 pt-10 sm:px-6 sm:pt-14 xl:grid-cols-[minmax(0,1fr)_16rem]">
        <article className="min-w-0 max-w-3xl">
          <div
            className="prose prose-slate max-w-none prose-headings:tracking-tight prose-h2:text-[22px] prose-h3:text-[18px] prose-p:text-[16px] prose-p:leading-relaxed prose-li:text-[16px] prose-table:text-sm prose-td:px-3 prose-td:py-2 prose-th:px-3 prose-th:py-2"
            dangerouslySetInnerHTML={{ __html: renderArticleMarkdown(body) }}
          />
          <p className="mt-8 text-[12px] text-ink-muted">
            Bank Fee Index figures come from banks&apos; and credit unions&apos; own published fee schedules.{" "}
            <Link href="/methodology" className={LINK}>
              How we build them
            </Link>
          </p>
        </article>

        {relatedArticles.length > 0 && (
          <aside aria-labelledby="related-heading" className="xl:pt-1">
            <h2 id="related-heading" className="text-[15px] font-semibold text-ink">
              More research
            </h2>
            <ul className="mt-3 space-y-3">
              {relatedArticles.map((ra) => (
                <li key={ra.slug}>
                  <Link href={`/research/articles/${ra.slug}`} className="block text-[14px] font-medium leading-snug text-ink hover:text-brick">
                    {ra.title}
                  </Link>
                  <span className="text-[12px] capitalize text-ink-muted">{ra.category}</span>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>

      <section aria-labelledby="hamilton-heading" className="mx-auto max-w-page px-4 pb-16 pt-12 sm:px-6 sm:pt-16">
        <div className="rounded-2xl border border-border bg-surface-0 px-5 py-7 sm:px-8">
          <h2 id="hamilton-heading" className="text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-[22px]">
            Work at a bank or credit union?
          </h2>
          <p className="mt-2 max-w-[38rem] text-[14px] text-ink-muted">
            Hamilton shows your fees beside the competitors you choose, kept current, with the source for every figure.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
            <TrackLink
              event="upgrade_click"
              eventProps={{ placement: "research_article" }}
              href={PRO_PLANS_NAV.href}
              className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink hover:opacity-90"
            >
              {PRO_PLANS_NAV.label}
            </TrackLink>
            <Link href={DEMO_REQUEST_NAV.href} className="text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
              {DEMO_REQUEST_NAV.label}
            </Link>
          </div>
          <p className="mt-4 text-[13px] text-ink-muted">
            One institution, one report:{" "}
            <TrackLink
              event="request_report_click"
              eventProps={{ placement: "research_article" }}
              href="/reports?report=institution&src=research-article#request"
              className="font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
            >
              the {REPORT_OFFER.name}, {REPORT_PRICE_INLINE}
            </TrackLink>
            .
          </p>
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: article.title,
            description: article.subtitle || plainSummary(body),
            author: { "@type": "Organization", name: byline(article.author) },
            datePublished: isoDate(article.published_at),
            dateModified: isoDate(article.updated_at),
            mainEntityOfPage: `${SITE_URL}/research/articles/${slug}`,
            publisher: { "@type": "Organization", name: SITE_NAME },
          }).replace(/</g, "\\u003c"),
        }}
      />
    </>
  );
}
