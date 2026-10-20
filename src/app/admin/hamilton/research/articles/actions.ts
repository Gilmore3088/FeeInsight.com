"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { updateArticle, deleteArticle } from "@/lib/data-store/articles";

/**
 * The cached public pages that list or show articles (#1811): every article page and the
 * research hub. A route pattern is matched with its route group, so the group is named here.
 */
function revalidatePublicArticles() {
  revalidatePath("/(public)/research/articles/[slug]", "page");
  revalidatePath("/research");
}

export async function updateArticleAction(
  id: number,
  data: Partial<{
    title: string;
    subtitle: string | null;
    content: string;
    category: string;
    tags: string[];
    status: string;
  }>
): Promise<{ success: boolean; error?: string }> {
  await requireAuth("edit");
  try {
    const updated = await updateArticle(id, data);
    if (!updated) return { success: false, error: "Article not found" };
    revalidatePath("/admin/hamilton/research/articles");
    revalidatePath("/research/articles");
    revalidatePublicArticles();
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to update article";
    return { success: false, error: msg };
  }
}

export async function deleteArticleAction(
  id: number
): Promise<{ success: boolean; error?: string }> {
  await requireAuth("edit");
  try {
    const deleted = await deleteArticle(id);
    if (!deleted) return { success: false, error: "Article not found" };
    revalidatePath("/admin/hamilton/research/articles");
    revalidatePublicArticles();
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to delete article";
    return { success: false, error: msg };
  }
}
