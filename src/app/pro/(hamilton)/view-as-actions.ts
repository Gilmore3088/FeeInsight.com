"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { VIEW_AS_CUSTOMER_COOKIE } from "@/lib/hamilton/view-as";

/** Admin-only toggle between the admin view and exactly what a customer sees. */
export async function setViewAsCustomer(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user || (user.role !== "admin" && user.role !== "analyst")) return;

  const on = formData.get("mode") === "customer";
  const jar = await cookies();
  if (on) {
    jar.set(VIEW_AS_CUSTOMER_COOKIE, "1", { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 8 });
  } else {
    jar.delete(VIEW_AS_CUSTOMER_COOKIE);
  }
  revalidatePath("/pro", "layout");
}
