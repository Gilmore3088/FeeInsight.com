"use server";

import { incrementViewCount } from "@/lib/data-store/articles";

/** One view of a published article (an unknown or unpublished slug changes nothing). */
export async function recordArticleView(slug: string): Promise<void> {
  if (typeof slug !== "string" || slug.length === 0 || slug.length > 200) return;
  await incrementViewCount(slug);
}
