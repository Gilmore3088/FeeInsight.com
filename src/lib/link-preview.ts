import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/constants";

/**
 * Link-preview metadata (Open Graph and X/Twitter card) for a page, so a link shared on
 * LinkedIn, Slack or email shows this page's own title and summary. Next merges metadata
 * shallowly, so a page that sets `openGraph` replaces the root layout's: this keeps the
 * site name and type the layout sets. A page-level `openGraph` also drops the image the root
 * `src/app/opengraph-image.tsx` file adds (prod /research/state/TX had no og:image), so the
 * image is named here explicitly.
 */
export function linkPreview({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  /** Site-relative URL of the page, resolved against `metadataBase`. */
  path: string;
}): Pick<Metadata, "openGraph" | "twitter"> {
  return {
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title,
      description,
      url: path,
      images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: title }],
    },
    twitter: { card: "summary_large_image", title, description, images: ["/twitter-image"] },
  };
}
