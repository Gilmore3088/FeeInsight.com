export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after } from "next/server";
import Link from "next/link";
import { incrementViewCount, getPublishedArticles, type Article } from "@/lib/data-store/articles";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { TrackLink } from "@/components/track-link";
import { DEMO_REQUEST_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { PAGE_HEADER } from "@/components/public/page-header";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { PRODUCT_NAME, REPORT_OFFER, RESEARCH_IMPRINT, SITE_NAME, SITE_URL } from "@/lib/constants";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";
import { linkPreview } from "@/lib/link-preview";
import { renderArticleMarkdown } from "@/lib/article-markdown";
import { SourceNote } from "../../district/[id]/district-hub";
import { ArticleExhibit } from "./article-exhibits";
import { bylineDate, parseArticle, plainSummary, type ArticleSection, type Exhibit } from "./article-view";
import { loadPublishedArticle } from "./load-article";

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** The product is not an author: the research imprint signs anything filed under it (brand rule). */
function byline(author: string | null | undefined): string {
  return !author || author === PRODUCT_NAME || author === SITE_NAME ? RESEARCH_IMPRINT : author;
}

const LINK = "font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink";
const H2 = "text-[22px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink sm:text-[28px]";
/** Article paragraphs and lists, as stored, in the page's own type and colors. */
const BODY =
  "space-y-3 text-[15px] leading-relaxed text-ink-soft [&_a]:font-medium [&_a]:text-ink [&_a]:underline [&_a]:decoration-border [&_a]:underline-offset-4 [&_li]:mt-1.5 [&_strong]:font-semibold [&_strong]:text-ink [&_ul]:list-disc [&_ul]:pl-5";

function Markdown({ blocks }: { blocks: string[] }) {
  if (blocks.length === 0) return null;
  return <div className={BODY} dangerouslySetInnerHTML={{ __html: renderArticleMarkdown(blocks.join("\n\n")) }} />;
}

/** The finding line: one paragraph, its Markdown marks rendered. */
function Finding({ text }: { text: string }) {
  return (
    <div
      className="mt-3 text-[16px] leading-relaxed text-ink [&_a]:underline [&_a]:decoration-border [&_a]:underline-offset-4 [&_strong]:font-semibold"
      dangerouslySetInnerHTML={{ __html: renderArticleMarkdown(text) }}
    />
  );
}

function Exhibits({ exhibits, source }: { exhibits: Exhibit[]; source: string }) {
  return (
    <div className="min-w-0 space-y-10">
      {exhibits.map((exhibit, i) => (
        <ArticleExhibit key={i} exhibit={exhibit} />
      ))}
      <SourceNote>{source}</SourceNote>
    </div>
  );
}

function Section({ section, defaultSource }: { section: ArticleSection; defaultSource: string }) {
  const head = (
    <div className="max-w-3xl">
      <h2 id={`${section.id}-heading`} className={H2}>
        {section.title}
      </h2>
      {section.finding && <Finding text={section.finding} />}
      {section.notes.length > 0 && (
        <div className="mt-4">
          <Markdown blocks={section.notes} />
        </div>
      )}
    </div>
  );
  return (
    <section id={section.id} aria-labelledby={`${section.id}-heading`} className="scroll-mt-24">
      {section.exhibits.length > 0 ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:gap-14 xl:gap-20">
          {head}
          <Exhibits exhibits={section.exhibits} source={section.source ?? defaultSource} />
        </div>
      ) : (
        <>
          {head}
          {section.source && (
            <div className="mt-4">
              <SourceNote>{section.source}</SourceNote>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await loadPublishedArticle(slug);
  if (!article) return { title: "Article Not Found" };
  // The root template adds "| Fee Insight"; a second suffix would only push the headline past the cut.
  const title = article.title;
  const description = article.subtitle || plainSummary(parseArticle(article.content));
  const path = `/research/articles/${article.slug}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    ...linkPreview({ title: article.title, description, path }),
  };
}

export default async function ArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const article = await loadPublishedArticle(slug);
  if (!article) notFound();

  // The view is counted after the response is sent: no database write holds the page.
  after(() => incrementViewCount(slug).catch(() => undefined));

  const [related, user, sampleLive] = await Promise.all([
    getPublishedArticles(4).catch(() => [] as Article[]),
    getCurrentUser().catch(() => null),
    sampleReportAvailable().catch(() => false),
  ]);
  const relatedArticles = related.filter((a) => a.slug !== slug).slice(0, 3);
  const isPro = canAccessPremium(user);

  const brief = parseArticle(article.content);
  const published = bylineDate(article.published_at);
  const asOf = brief.asOf;
  const defaultSource = `${PRODUCT_NAME}, from banks' and credit unions' own published fee schedules.${
    asOf ? ` Data as of ${asOf}.` : published ? ` Published ${published.label}.` : ""
  }`;
  const path = `/research/articles/${slug}`;

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Research", href: "/research" },
          { name: article.title, href: path },
        ]}
      />

      {/* Opening: the headline, a dated byline and the article's own opening finding. */}
      <header className="border-b border-border bg-paper">
        <div className={`mx-auto max-w-page px-4 pb-8 pt-4 sm:px-6 sm:pb-10 sm:pt-8 ${PAGE_HEADER}`}>
          <nav aria-label="Breadcrumb" className="flex items-center justify-center gap-2 text-[12px] text-ink-muted sm:justify-start">
            <Link href="/research" className="inline-flex min-h-11 items-center hover:text-ink">
              Research
            </Link>
            <span aria-hidden="true">/</span>
            <span className="capitalize text-ink-soft">{article.category}</span>
          </nav>
          <h1 className="mx-auto mt-1 max-w-4xl text-[30px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:mx-0 sm:mt-2 sm:text-[44px]">
            {article.title}
          </h1>
          {article.subtitle && <p className="mt-3 text-[16px] leading-relaxed text-ink-soft sm:mx-0 sm:text-[17px]">{article.subtitle}</p>}
          <p className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[13px] text-ink-muted sm:mx-0 sm:justify-start">
            <span>{byline(article.author)}</span>
            {published && (
              <>
                <span aria-hidden="true">·</span>
                <time dateTime={published.iso}>{published.label}</time>
              </>
            )}
            {asOf && (
              <>
                <span aria-hidden="true">·</span>
                <span>Data as of {asOf}</span>
              </>
            )}
          </p>
          {brief.lead.length > 0 && (
            <div
              className="mt-6 border-t border-border pt-5 text-[17px] leading-relaxed text-ink sm:text-[19px] [&_p]:mx-auto sm:[&_p]:mx-0 [&_strong]:font-semibold"
              dangerouslySetInnerHTML={{ __html: renderArticleMarkdown(brief.lead.join("\n\n")) }}
            />
          )}
        </div>
      </header>

      <div className="mx-auto max-w-page px-4 pb-14 pt-10 sm:px-6 sm:pb-20 sm:pt-14">
        <div className="space-y-14 sm:space-y-20">
          {brief.leadExhibits.length > 0 && <Exhibits exhibits={brief.leadExhibits} source={defaultSource} />}

          {brief.sections.map((section) => (
            <Section key={section.id} section={section} defaultSource={defaultSource} />
          ))}

          {/* How the figures were built: the article's own method section, one tap away. */}
          <details className="group/method border-t border-border pt-4">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[16px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="transition-transform group-open/method:rotate-90">
                &rsaquo;
              </span>
              {brief.method?.title ?? "How these numbers are built"}
            </summary>
            <div className="mt-4 max-w-3xl space-y-4 pb-2">
              {brief.method ? (
                <Markdown blocks={brief.method.blocks} />
              ) : (
                <p className="text-[15px] leading-relaxed text-ink-soft">
                  Figures come from each institution&apos;s own published fee schedule, one value per institution.
                </p>
              )}
              <p className="text-[14px] text-ink-soft">
                <Link href="/methodology" className={LINK}>
                  The {PRODUCT_NAME} methodology
                </Link>
              </p>
            </div>
          </details>

          {/* Hamilton, once. */}
          {!isPro && (
            <section aria-labelledby="hamilton-heading" className="rounded-2xl bg-paper px-4 py-6 ring-1 ring-border sm:px-8 sm:py-8 print:hidden">
              <h2 id="hamilton-heading" className="text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-[22px]">
                Set one institution&apos;s fees against these figures
              </h2>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-soft sm:mx-0">
                Hamilton, the {SITE_NAME} Pro workspace, sets an institution&apos;s own published fees beside the peers and markets it
                chooses, with the source document for every figure.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
                <TrackLink
                  event="upgrade_click"
                  eventProps={{ placement: "research_article_end", article: slug }}
                  href={PRO_PLANS_NAV.href}
                  className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink hover:opacity-90"
                >
                  {PRO_PLANS_NAV.label}
                </TrackLink>
                {sampleLive ? (
                  <TrackLink
                    event="sample_report_click"
                    eventProps={{ placement: "research_article_end", article: slug }}
                    href="/reports/sample-competitive-fee-position"
                    className="inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
                  >
                    See the sample {REPORT_OFFER.name}
                  </TrackLink>
                ) : (
                  <TrackLink
                    event="contact_sales"
                    eventProps={{ placement: "research_article_end_demo", article: slug }}
                    href={DEMO_REQUEST_NAV.href}
                    className="inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
                  >
                    {DEMO_REQUEST_NAV.standaloneLabel}
                  </TrackLink>
                )}
              </div>
            </section>
          )}
          {relatedArticles.length > 0 && (
            <section aria-labelledby="related-heading">
              <h2 id="related-heading" className="text-[18px] font-semibold text-ink">
                More research
              </h2>
              <ul className="mt-3 grid gap-x-10 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                {relatedArticles.map((ra) => {
                  const date = bylineDate(ra.published_at);
                  return (
                    <li key={ra.slug} className="border-t border-border pt-3">
                      <Link href={`/research/articles/${ra.slug}`} className="block text-[15px] font-medium leading-snug text-ink hover:text-brick">
                        {ra.title}
                      </Link>
                      {date && <span className="text-[12px] text-ink-muted">{date.label}</span>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

        </div>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: article.title,
            description: article.subtitle || plainSummary(brief),
            author: { "@type": "Organization", name: byline(article.author), url: SITE_URL },
            datePublished: published?.iso,
            dateModified: bylineDate(article.updated_at)?.iso,
            mainEntityOfPage: `${SITE_URL}${path}`,
            publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
          }).replace(/</g, "\\u003c"),
        }}
      />
    </>
  );
}
