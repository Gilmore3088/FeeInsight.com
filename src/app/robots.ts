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
        disallow: ["/admin/", "/api/", "/r/", "/market-report/", "/pay/", "/pro/", "/account", "/workspace-invite", "/confirm-email"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
