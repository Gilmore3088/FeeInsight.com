import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/constants";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /r/, /market-report/ and /pay/ host per-institution report and pay links; they are private by
        // token, not for indexing. /pro, /account and invites sit behind sign-in.
        // "/fees?" is the index explorer's filter views (fee, state, charter, bar, search, page, map view):
        // every one renders fresh, all share the canonical /fees, and their links multiply without end.
        // A crawler walking them took ~22 renders a minute on Oct 25-26 and starved institution pages.
        disallow: [
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
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
