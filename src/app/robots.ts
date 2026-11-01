import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/constants";

// /r/, /market-report/ and /pay/ host per-institution report and pay links; they are private by
// token, not for indexing. /pro, /account and invites sit behind sign-in.
// "/fees?" is the index explorer's filter views (fee, state, charter, bar, search, page, map view):
// every one renders fresh, all share the canonical /fees, and their links multiply without end.
// A crawler walking them took ~22 renders a minute on Oct 25-26 and starved institution pages.
const PRIVATE_AND_ENDLESS = [
  "/admin/",
  "/api/",
  "/r/",
  "/market-report/",
  "/pay/",
  "/pro/",
  "/account",
  "/workspace-invite",
  "/confirm-email",
  "/fees?",
];

// A crawler obeys only the group that names it, so a named group repeats the shared list.
// Amazonbot walked the long tail of institution pages at ~8,200 uncached renders a day (Nov 1),
// each a full render of the page's reads, and kept them past their read budget; it sends no
// search visitors. It spreads across addresses, so a per-IP rate limit does not catch it.
const INSTITUTION_PAGE_CRAWLERS = ["Amazonbot"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE_AND_ENDLESS },
      { userAgent: INSTITUTION_PAGE_CRAWLERS, allow: "/", disallow: [...PRIVATE_AND_ENDLESS, "/institution/"] },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
