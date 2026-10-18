export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after } from "next/server";
import Link from "next/link";
import { ArrowRight, ChartColumn, Table2, TextQuote, type LucideIcon } from "lucide-react";
import { incrementViewCount, getPublishedArticles, type Article } from "@/lib/data-store/articles";
import { getGuidesForCategory } from "@/lib/data-store/guides";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { TrackLink } from "@/components/track-link";
import { DEMO_REQUEST_NAV, PRIMARY_CTA_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { PAGE_CRUMBS, PAGE_HEADER, PAGE_HEADER_BLOCK } from "@/components/public/page-header";
import { homeSerif } from "@/app/landing-serif";
import { SERIF, SERIF_HEAD } from "@/app/landing-shared";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { PRODUCT_NAME, REPORT_OFFER, RESEARCH_IMPRINT, SITE_NAME, SITE_URL } from "@/lib/constants";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";
import { linkPreview } from "@/lib/link-preview";
import { renderArticleMarkdown, renderInlineMarkdown } from "@/lib/article-markdown";
import { SourceNote } from "../../district/[id]/district-hub";
import { ArticleExhibit } from "./article-exhibits";
import {
  articleTags,
  bylineDate,
  parseArticle,
  plainSummary,
  plainText,
  takeaways,
  type ArticleSection,
  type ExhibitGroup,
  type Takeaway,
} from "./article-view";
import { loadPublishedArticle } from "./load-article";
import { PREVIEW_FIXTURE_SLUG } from "./preview-fixture";

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** The product is not an author: the research imprint signs anything filed under it (brand rule). */
function byline(author: string | null | undefined): string {
  return !author || author === PRODUCT_NAME || author === SITE_NAME ? RESEARCH_IMPRINT : author;
}

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
const LINK = "font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink";
/** Section heads in the homepage serif (SERIF), at the article's own section size. */
const H2 = "text-[24px] !font-medium leading-[1.12] tracking-[-0.02em] text-ink sm:text-[30px]";
/** The band's second action: a text link with an arrow, as on the institution page. */
const SECONDARY =
  "inline-flex min-h-11 items-center gap-2 rounded-sm text-[15px] font-medium text-ink underline decoration-border underline-offset-[6px] hover:decoration-ink";
/** Article paragraphs, lists and subheads, as stored, in the page's own type and colors. */
const BODY =
  "space-y-3 break-words text-[15px] leading-relaxed text-ink-soft [&_a]:font-medium [&_a]:text-ink [&_a]:underline [&_a]:decoration-border [&_a]:underline-offset-4 [&_h3]:pt-2 [&_h3]:text-[17px] [&_h3]:font-semibold [&_h3]:text-ink [&_li]:mt-1.5 [&_strong]:font-semibold [&_strong]:text-ink [&_ul]:list-disc [&_ul]:pl-5";

/** Prose blocks only: tables and charts were lifted out as exhibits before they reach here. */
function Markdown({ blocks }: { blocks: string[] }) {
  if (blocks.length === 0) return null;
  return <div className={BODY} dangerouslySetInnerHTML={{ __html: renderArticleMarkdown(blocks.join("\n\n")) }} />;
}

/** The finding line: one paragraph, its Markdown marks rendered. */
function Finding({ text }: { text: string }) {
  return (
    <div
      className="mt-3 break-words text-[16px] leading-relaxed text-ink [&_a]:underline [&_a]:decoration-border [&_a]:underline-offset-4 [&_strong]:font-semibold"
      dangerouslySetInnerHTML={{ __html: renderArticleMarkdown(text) }}
    />
  );
}

/** A source line as the article wrote it (links and marks rendered); long URLs wrap on a phone. */
function Source({ text }: { text: string }) {
  return (
    <SourceNote>
      <span className="break-words [overflow-wrap:anywhere]" dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(text) }} />
    </SourceNote>
  );
}

function Exhibits({ group }: { group: ExhibitGroup }) {
  if (group.exhibits.length === 0) return group.source ? <Source text={group.source} /> : null;
  return (
    <div className="min-w-0 space-y-10">
      {group.exhibits.map((exhibit, i) => (
        <ArticleExhibit key={i} exhibit={exhibit} />
      ))}
      {group.source && <Source text={group.source} />}
    </div>
  );
}

/** A one-tap disclosure, closed at first: the method, and the paragraphs that follow an exhibit. */
function Disclosure({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="group/more">
      <summary
        className={`flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sm text-[15px] font-semibold text-ink [&::-webkit-details-marker]:hidden ${FOCUS}`}
      >
        <span aria-hidden="true" className="transition-transform group-open/more:rotate-90 motion-reduce:transition-none">
          &rsaquo;
        </span>
        {summary}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

const EVIDENCE: Record<Takeaway["evidence"], { icon: LucideIcon; label: string }> = {
  chart: { icon: ChartColumn, label: "chart" },
  table: { icon: Table2, label: "table" },
  text: { icon: TextQuote, label: "section" },
};
const TAKEAWAY_COLS = ["", "", "lg:grid-cols-2", "lg:grid-cols-3"];

/** The article's points, one line each; the icon says what backs the point up, and the point links to it. */
function Takeaways({ points }: { points: Takeaway[] }) {
  if (points.length === 0) return null;
  return (
    <ul aria-label="Key points" className={`mx-auto mt-6 grid max-w-[34rem] gap-2 text-left sm:mx-0 sm:max-w-none ${TAKEAWAY_COLS[points.length] ?? ""}`}>
      {points.map((point) => {
        const { icon: Icon, label } = EVIDENCE[point.evidence];
        return (
          <li key={point.id} className="min-w-0">
            <a
              href={`#${point.id}`}
              className={`group flex h-full min-h-11 items-start gap-3 rounded-xl bg-surface-0 p-3 ring-1 ring-border hover:ring-ink/40 ${FOCUS}`}
            >
              <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-brick-tint text-brick">
                <Icon className="size-[18px]" strokeWidth={2} />
              </span>
              <span className="min-w-0 pt-1.5 text-[15px] font-medium leading-snug text-ink">
                {plainText(point.text)}
                <span className="sr-only">, see the {label}</span>
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** Title, finding, exhibit, source, then any further paragraphs. */
function Section({ section }: { section: ArticleSection }) {
  const head = (
    <div className="max-w-3xl">
      <h2
        id={`${section.id}-heading`}
        className={H2}
        style={SERIF}
        dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(section.title) }}
      />
      {section.finding && <Finding text={section.finding} />}
    </div>
  );
  // Beside an exhibit, the further paragraphs wait behind one tap so the figures carry the section.
  const notes =
    section.notes.length > 0 &&
    (section.exhibits.length > 0 ? (
      <div className="max-w-3xl">
        <Disclosure summary="More on this">
          <Markdown blocks={section.notes} />
        </Disclosure>
      </div>
    ) : (
      <div className="max-w-3xl">
        <Markdown blocks={section.notes} />
      </div>
    ));
  return (
    <section id={section.id} aria-labelledby={`${section.id}-heading`} className="scroll-mt-24">
      {section.exhibits.length > 0 ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:gap-14 xl:gap-20">
          {head}
          <div className="min-w-0 space-y-8">
            <Exhibits group={section} />
            {notes}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {head}
          {section.source && <Source text={section.source} />}
          {notes}
        </div>
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
    // The preview fixture is never indexed.
    ...(article.slug === PREVIEW_FIXTURE_SLUG ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function ArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const article = await loadPublishedArticle(slug);
  if (!article) notFound();
  const fixture = article.slug === PREVIEW_FIXTURE_SLUG;

  // The view is counted after the response is sent: no database write holds the page.
  if (!fixture) after(() => incrementViewCount(slug).catch(() => undefined));

  const tags = articleTags(article.tags);
  const [related, user, sampleLive, guides] = await Promise.all([
    getPublishedArticles(4).catch(() => [] as Article[]),
    getCurrentUser().catch(() => null),
    sampleReportAvailable().catch(() => false),
    tags[0] ? getGuidesForCategory(tags[0]).catch(() => []) : Promise.resolve([]),
  ]);
  const relatedArticles = related.filter((a) => a.slug !== slug).slice(0, 3);
  const guide = guides[0] ?? null;
  const isPro = canAccessPremium(user);

  const published = bylineDate(article.published_at);
  // The "As of" date is read before the source line is built, so a first pass finds it.
  const asOf = parseArticle(article.content).asOf;
  const defaultSource = `${PRODUCT_NAME}, from banks' and credit unions' own published fee schedules.${
    asOf ? ` Data as of ${asOf}.` : published ? ` Published ${published.label}.` : ""
  }`;
  const brief = parseArticle(article.content, defaultSource);
  const path = `/research/articles/${slug}`;
  const points = takeaways(brief);

  return (
    <div className={homeSerif.variable}>
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
          {fixture && (
            <p role="note" className="mb-3 inline-block rounded-sm bg-ink px-2 py-1 text-[12px] font-semibold text-on-ink">
              Preview fixture, not published. Figures are placeholders.
            </p>
          )}
          <nav aria-label="Breadcrumb" className={PAGE_CRUMBS}>
            <Link href="/research" className={`inline-flex min-h-11 items-center rounded-sm hover:text-ink ${FOCUS}`}>
              Research
            </Link>
            <span aria-hidden="true">/</span>
            <span className="capitalize text-ink-soft">{article.category}</span>
          </nav>
          <h1 className={`mx-auto mt-1 max-w-4xl text-ink sm:mx-0 sm:mt-2 ${SERIF_HEAD}`} style={SERIF}>
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
          <Takeaways points={points} />
          {brief.lead.length > 0 && (
            <div
              className={`mt-6 border-t border-border pt-5 text-[17px] leading-relaxed text-ink sm:text-[19px] [&_strong]:font-semibold ${PAGE_HEADER_BLOCK}`}
              dangerouslySetInnerHTML={{ __html: renderArticleMarkdown(brief.lead.join("\n\n")) }}
            />
          )}
        </div>
      </header>

      <div className="mx-auto max-w-page px-4 pb-14 pt-10 sm:px-6 sm:pb-20 sm:pt-14">
        <div className="space-y-14 sm:space-y-20">
          {(brief.leadExhibits.exhibits.length > 0 || brief.leadExhibits.source) && <Exhibits group={brief.leadExhibits} />}

          {brief.sections.map((section) => (
            <Section key={section.id} section={section} />
          ))}

          {/* How the figures were built: the article's own method section, one tap away. */}
          <details className="group/method border-t border-border pt-4">
            <summary
              className={`flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sm text-[16px] font-semibold text-ink [&::-webkit-details-marker]:hidden ${FOCUS}`}
            >
              <span aria-hidden="true" className="transition-transform group-open/method:rotate-90">
                &rsaquo;
              </span>
              {brief.method ? plainText(brief.method.title) : "How these numbers are built"}
            </summary>
            <div className="mt-4 space-y-8 pb-2">
              <div className="max-w-3xl space-y-4">
                {brief.method && brief.method.blocks.length > 0 ? (
                  <Markdown blocks={brief.method.blocks} />
                ) : (
                  !brief.method && (
                    <p className="text-[15px] leading-relaxed text-ink-soft">
                      Figures come from each institution&apos;s own published fee schedule, one value per institution.
                    </p>
                  )
                )}
              </div>
              {brief.method && <Exhibits group={brief.method} />}
              <p className="text-[14px] text-ink-soft">
                <Link href="/methodology" className={`${LINK} inline-flex min-h-11 items-center rounded-sm ${FOCUS}`}>
                  The {PRODUCT_NAME} methodology
                </Link>
              </p>
            </div>
          </details>

          {/* Hamilton, once, in the house band: "Hey Hamilton," one line, one action. */}
          {!isPro && (
            <section aria-labelledby="hamilton-heading" className="border-t border-border pt-10 sm:pt-12 print:hidden">
              <h2 id="hamilton-heading" className={`${SERIF_HEAD} text-ink`} style={SERIF}>
                <span className="block text-brick">Hey Hamilton,</span>
                <span className="block">How do our fees compare?</span>
              </h2>
              <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
                Hamilton sets your own published fees beside the peers and markets you choose.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-x-7 gap-y-4">
                <TrackLink
                  event="upgrade_click"
                  eventProps={{ placement: "research_article_end", article: slug }}
                  href={PRO_PLANS_NAV.href}
                  className={`fi-btn fi-btn-brick min-h-12 px-8 text-[15px] ${FOCUS}`}
                >
                  {PRO_PLANS_NAV.label}
                </TrackLink>
                {sampleLive ? (
                  <TrackLink
                    event="sample_report_click"
                    eventProps={{ placement: "research_article_end", article: slug }}
                    href="/reports/sample-competitive-fee-position"
                    className={`${SECONDARY} ${FOCUS}`}
                  >
                    See the sample {REPORT_OFFER.name}
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </TrackLink>
                ) : (
                  <TrackLink
                    event="contact_sales"
                    eventProps={{ placement: "research_article_end_demo", article: slug }}
                    href={DEMO_REQUEST_NAV.href}
                    className={`${SECONDARY} ${FOCUS}`}
                  >
                    {DEMO_REQUEST_NAV.standaloneLabel}
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </TrackLink>
                )}
              </div>
            </section>
          )}

          {/* A quiet next step for a reader checking their own bank: text links, no second button. */}
          <p className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[14px] text-ink-soft sm:mx-0">
            <Link href={PRIMARY_CTA_NAV.href} className={`${LINK} inline-flex min-h-11 items-center rounded-sm ${FOCUS}`}>
              Look up a bank or credit union&apos;s fees
            </Link>
            {guide && (
              <Link href={`/guides/${guide.slug}`} className={`${LINK} inline-flex min-h-11 items-center rounded-sm ${FOCUS}`}>
                {guide.title}
              </Link>
            )}
          </p>

          {relatedArticles.length > 0 && (
            <section aria-labelledby="related-heading">
              <h2 id="related-heading" className="text-[18px] font-semibold text-ink">
                More research
              </h2>
              <ul className="mt-3 grid gap-x-10 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                {relatedArticles.map((ra) => {
                  const date = bylineDate(ra.published_at);
                  return (
                    <li key={ra.slug} className="border-t border-border pt-2">
                      <Link
                        href={`/research/articles/${ra.slug}`}
                        className={`flex min-h-11 items-center rounded-sm text-[15px] font-medium leading-snug text-ink hover:text-brick ${FOCUS}`}
                      >
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

      {!fixture && (
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
      )}
    </div>
  );
}
