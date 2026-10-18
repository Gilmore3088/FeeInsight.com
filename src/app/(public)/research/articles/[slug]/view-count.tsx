"use client";

import { useEffect } from "react";
import { recordArticleView } from "./actions";

/**
 * Counts one view of the article from the browser. The page is cached (ISR), so the server
 * render runs about once an hour, not once per reader, and cannot count views itself.
 */
export function ArticleViewCount({ slug }: { slug: string }) {
  useEffect(() => {
    recordArticleView(slug).catch(() => undefined);
  }, [slug]);
  return null;
}
