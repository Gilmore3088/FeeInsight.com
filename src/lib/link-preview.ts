import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/constants";

/**
 * Link-preview metadata (Open Graph and X/Twitter card) for a page, so a link shared on
 * LinkedIn, Slack or email shows this page's own title and summary. Next merges metadata
 * shallowly, so a page that sets `openGraph` replaces the root layout's: this keeps the
 * site name and type the layout sets. The image comes from `src/app/opengraph-image.tsx`.
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
    openGraph: { type: "website", siteName: SITE_NAME, title, description, url: path },
    twitter: { card: "summary_large_image", title, description },
  };
}
