export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getArticleBySlug, incrementViewCount, getPublishedArticles } from "@/lib/data-store/articles";
import { ensureResearchTables } from "@/lib/research/history";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { SITE_NAME } from "@/lib/constants";
import { linkPreview } from "@/lib/link-preview";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  await ensureResearchTables();
  const article = await getArticleBySlug(slug);
  if (!article || article.status !== "published") {
    return { title: "Article Not Found" };
  }
  const title = `${article.title} — Research`;
  const description = article.subtitle || article.content.substring(0, 160).replace(/[#*_]/g, "");
  const path = `/research/articles/${article.slug}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    ...linkPreview({ title: article.title, description, path }),
  };
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await ensureResearchTables();
  const article = await getArticleBySlug(slug);

  if (!article || article.status !== "published") {
    notFound();
  }

  await incrementViewCount(slug);

  const relatedArticles = (await getPublishedArticles(4)).filter((a) => a.slug !== slug).slice(0, 3);

  const publishedDate = article.published_at
    ? new Date(article.published_at).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="mx-auto max-w-7xl px-6 py-14">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Research", href: "/research" },
          { name: article.title, href: `/research/articles/${slug}` },
        ]}
      />

      <div className="grid grid-cols-1 gap-10 xl:grid-cols-[1fr_280px]">
        {/* Main content */}
        <article className="min-w-0">
          <div className="mb-8">
            <Link
              href="/research"
              className="text-[11px] font-semibold uppercase tracking-wider text-[#6B6255] hover:text-[#1A1815] transition-colors"
            >
              &larr; Research
            </Link>
            <h1
              className="mt-3 text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] font-extrabold text-[#1A1815]"
              style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
            >
              {article.title}
            </h1>
            {article.subtitle && (
              <p className="mt-2 text-[15px] text-[#6B6255]">{article.subtitle}</p>
            )}
            <div className="mt-3 flex items-center gap-3 text-[12px] text-[#6B6255]">
              <span>{article.author}</span>
              {publishedDate && (
                <>
                  <span className="text-[#D4C9BA]">&middot;</span>
                  <span>{publishedDate}</span>
                </>
              )}
              <span className="text-[#D4C9BA]">&middot;</span>
              <span className="capitalize">{article.category}</span>
            </div>
          </div>

          {/* Render markdown as HTML-safe prose */}
          <div className="prose prose-slate max-w-none prose-headings:tracking-tight prose-h2:text-lg prose-h3:text-base prose-p:text-[15px] prose-p:leading-relaxed prose-li:text-[15px] prose-table:text-sm prose-td:px-3 prose-td:py-2 prose-th:px-3 prose-th:py-2">
            <MarkdownContent content={article.content} />
          </div>

          {/* CTA */}
          <div className="mt-12 rounded-xl border border-[#E8DFD1]/80 bg-[#FAF7F2]/50 px-6 py-5">
            <p className="text-sm font-semibold text-[#1A1815]">
              Work at a bank or credit union?
            </p>
            <p className="mt-1 text-[13px] text-[#6B6255]">
              Request a free competitive fee report: every fee your institution publishes, benchmarked against a verified peer set.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Link
                href="/for-institutions#report"
                className="inline-flex items-center rounded-md bg-[#C44B2E] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[#A93D25] transition-colors"
              >
                Request your report
              </Link>
              <Link href="/institutions" className="text-[12px] font-medium text-[#A93D25] hover:underline">
                Or look up any bank&rsquo;s fees
              </Link>
            </div>
          </div>
        </article>

        {/* Sidebar */}
        <aside className="hidden xl:block">
          <div className="sticky top-24 space-y-5">
            {relatedArticles.length > 0 && (
              <div className="rounded-xl border border-[#E8DFD1]/80 px-4 py-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#6B6255] mb-3">
                  Related Research
                </p>
                <ul className="space-y-2">
                  {relatedArticles.map((ra) => (
                    <li key={ra.slug}>
                      <Link
                        href={`/research/articles/${ra.slug}`}
                        className="block text-[12px] font-medium text-[#5A5347] hover:text-[#A93D25] transition-colors leading-snug"
                      >
                        {ra.title}
                      </Link>
                      <span className="text-[10px] text-[#6B6255] capitalize">{ra.category}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-xl border border-[#E8DFD1]/80 px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#6B6255] mb-3">
                Explore
              </p>
              <ul className="space-y-1.5">
                <li>
                  <Link href="/research/national-fee-index" className="text-[12px] text-[#5A5347] hover:text-[#A93D25] transition-colors">
                    National Fee Index
                  </Link>
                </li>
                <li>
                  <Link href="/fees" className="text-[12px] text-[#5A5347] hover:text-[#A93D25] transition-colors">
                    Fee Categories
                  </Link>
                </li>
                <li>
                  <Link href="/guides" className="text-[12px] text-[#5A5347] hover:text-[#A93D25] transition-colors">
                    Consumer Guides
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </aside>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: article.title,
            description: article.subtitle || "",
            author: { "@type": "Organization", name: SITE_NAME },
            datePublished: article.published_at,
            publisher: { "@type": "Organization", name: SITE_NAME },
          }).replace(/</g, "\\u003c"),
        }}
      />
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  // Escape raw HTML first to prevent XSS
  const safe = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Quotes too: links below become href="…" attributes, and a raw " would end the attribute.
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  // Then apply markdown transformations on escaped content
  const html = safe
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links (only http/https)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Tables (simple)
    .replace(/^\|(.+)\|$/gm, (match) => {
      const cells = match.split('|').filter(Boolean).map(c => c.trim());
      if (cells.every(c => /^-+$/.test(c))) return '';
      const tag = match.includes('---') ? 'th' : 'td';
      return `<tr>${cells.map(c => `<${tag}>${c}</${tag}>`).join('')}</tr>`;
    })
    // Paragraphs
    .replace(/\n\n/g, '</p><p>')
    // Line breaks
    .replace(/\n/g, '<br/>');

  return (
    <div dangerouslySetInnerHTML={{ __html: `<p>${html}</p>` }} />
  );
}
