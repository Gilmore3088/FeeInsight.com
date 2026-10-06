import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/constants";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /r/ and /market-report/ host per-institution report links; they are private by
        // token, not for indexing. /pro, /account and invites sit behind sign-in.
        disallow: ["/admin/", "/api/", "/r/", "/market-report/", "/pro/", "/account", "/workspace-invite"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
