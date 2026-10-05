"use server";

import { getCurrentUser } from "@/lib/auth";
import { FEEDS, storeArticles } from "@/lib/data-store/news";
import { parseFeed } from "@/lib/regulatory/news";

const FETCH_TIMEOUT = 10_000;

export async function refreshFeeds(): Promise<{
  fetched: number;
  inserted: number;
  errors: string[];
}> {
  const user = await getCurrentUser();
  // Feed ingestion writes shared data: operators only.
  if (!user || (user.role !== "admin" && user.role !== "analyst")) {
    throw new Error("Unauthorized");
  }

  const allArticles: {
    guid: string;
    source: string;
    title: string;
    link: string;
    published_at: string | null;
  }[] = [];
  const errors: string[] = [];

  const fetchPromises = Object.entries(FEEDS).map(async ([source, url]) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "FeeInsight-News/1.0 (+https://feeinsight.com)" },
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        errors.push(`${source}: HTTP ${resp.status}`);
        return;
      }

      allArticles.push(...parseFeed(await resp.text(), source));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      errors.push(`${source}: ${msg}`);
    }
  });

  await Promise.all(fetchPromises);

  const inserted = await storeArticles(allArticles);

  return { fetched: allArticles.length, inserted, errors };
}
