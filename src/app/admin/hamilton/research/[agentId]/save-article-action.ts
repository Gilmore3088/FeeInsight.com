"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createArticle, getArticles } from "@/lib/data-store/articles";
import { toISO } from "@/lib/pg-helpers";

const MAX_DRAFTS_PER_DAY = 5;

export async function saveArticleFromChat(
  markdownContent: string
): Promise<{ success: boolean; slug?: string; error?: string }> {
  await requireAuth("edit");
  if (!markdownContent || markdownContent.length < 100) {
    return { success: false, error: "Content too short to save as article" };
  }

  // Safety: limit drafts per day
  const { articles: todayArticles } = await getArticles({ status: "draft" });
  const today = new Date().toISOString().split("T")[0];
  const todayCount = todayArticles.filter(
    (a) => toISO(a.created_at)?.startsWith(today)
  ).length;

  if (todayCount >= MAX_DRAFTS_PER_DAY) {
    return {
      success: false,
      error: `Daily draft limit reached (${MAX_DRAFTS_PER_DAY}/day). Review existing drafts before creating more.`,
    };
  }

  // Extract title from first markdown heading or first line
  const titleMatch = markdownContent.match(/^#\s+(.+)$/m);
  const title = titleMatch
    ? titleMatch[1].trim()
    : markdownContent.substring(0, 80).split("\n")[0].replace(/[#*]/g, "").trim();

  // Extract subtitle from second heading or first paragraph
  const subtitleMatch = markdownContent.match(/^##\s+(.+)$/m);
  const subtitle = subtitleMatch ? subtitleMatch[1].trim() : null;

  // Generate slug from title
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .substring(0, 60)
      .replace(/-$/, "") +
    "-" +
    Date.now().toString(36);

  // Detect category from content
  const lowerContent = markdownContent.toLowerCase();
  let category = "analysis";
  if (lowerContent.includes("guide") || lowerContent.includes("how to") || lowerContent.includes("consumer")) {
    category = "guide";
  } else if (lowerContent.includes("brief") || lowerContent.includes("outlook")) {
    category = "brief";
  } else if (lowerContent.includes("report") || lowerContent.includes("comprehensive")) {
    category = "report";
  }

  try {
    await createArticle({
      slug,
      title,
      subtitle: subtitle ?? undefined,
      content: markdownContent,
      category,
      generated_by: "content-writer",
    });

    revalidatePath("/admin/hamilton/research/articles");
    return { success: true, slug };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to save";
    return { success: false, error: msg };
  }
}
