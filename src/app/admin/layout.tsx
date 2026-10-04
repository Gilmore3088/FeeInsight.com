import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { BarChart3, ExternalLink } from "lucide-react";
import { getCurrentUser, type User } from "@/lib/auth";
import { LogoutButton } from "./logout-button";
import { AdminNav, AdminNavInline } from "./admin-nav";
import { getSourceSubmissionCounts } from "@/lib/admin-queries";
import { getKnoxReviewCounts } from "@/lib/data-store/knox-reviews";
import {
  CommandPalette,
  CommandPaletteTrigger,
} from "@/components/command-palette";
import { DarkModeToggle } from "@/components/dark-mode-toggle";
import { SITE_NAME } from "@/lib/constants";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminLayoutInner>{children}</AdminLayoutInner>;
}

async function AdminLayoutInner({
  children,
}: {
  children: React.ReactNode;
}) {
  const requestHeaders = await headers();
  // Both headers are set by the proxy, which overwrites any client-sent copy.
  if (
    requestHeaders.get("x-bfi-admin-login-route") === "1" &&
    requestHeaders.get("x-pathname") === "/admin/login"
  ) {
    return <>{children}</>;
  }

  let user: User | null = null;
  try {
    user = await getCurrentUser();
  } catch {
    // DB not available or session expired
  }

  if (!user) {
    redirect("/admin/login");
  }

  // Admin and analyst roles can enter the operator console; route-level
  // permissions still gate actions such as edits, approvals, and job triggers.
  if (user.role !== "admin" && user.role !== "analyst") {
    redirect("/account");
  }

  const roleBadgeColor =
    user.role === "admin"
      ? "bg-purple-500/10 text-purple-600 dark:text-purple-400"
      : user.role === "analyst"
        ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
        : "bg-gray-500/10 text-gray-500 dark:text-gray-400";

  let knoxPending = 0;
  let trustPending = 0;
  try {
    const [knoxCounts, sourceCounts] = await Promise.all([
      getKnoxReviewCounts(),
      getSourceSubmissionCounts(),
    ]);
    knoxPending = knoxCounts.pending;
    trustPending = sourceCounts.pending;
  } catch {
    // DB unavailable; drop the badge silently.
  }

  return (
    <div className="min-h-screen bg-[var(--admin-bg)]">
      {/* Skip to content */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-white focus:text-gray-900 focus:px-4 focus:py-2 focus:rounded-md focus:shadow-lg focus:ring-2 focus:ring-blue-500 focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>

      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/90 dark:bg-[oklch(0.16_0_0)]/90 backdrop-blur-xl border-b border-black/[0.04] dark:border-white/[0.05]">
        <div className="flex min-w-0 items-center justify-between h-[var(--admin-nav-h)] px-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Link
              href="/admin"
              prefetch={false}
              className="flex shrink-0 items-center gap-2 hover:opacity-80 transition-opacity"
              aria-label={`${SITE_NAME} — Dashboard`}
            >
              <BarChart3
                aria-hidden="true"
                className="h-[18px] w-[18px] text-[var(--brand-primary)]"
                strokeWidth={1.8}
              />
              <span className="text-[13px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100 hidden sm:inline">
                {SITE_NAME}
              </span>
            </Link>
            <AdminNavInline />
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <CommandPaletteTrigger />
            <DarkModeToggle />
            <div className="hidden sm:block h-3.5 w-px bg-gray-200/80 dark:bg-white/[0.06] mx-1" />
            <div className="hidden sm:block text-right">
              <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 leading-none">
                {user.display_name}
              </p>
              <span
                className={`inline-block rounded-full px-1.5 py-px text-[9px] font-bold mt-0.5 ${roleBadgeColor}`}
              >
                {user.role}
              </span>
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="hidden md:flex flex-col w-[180px] shrink-0 sticky top-[var(--admin-nav-h)] h-[calc(100vh-var(--admin-nav-h))] border-r border-black/[0.04] dark:border-white/[0.04] bg-white/60 dark:bg-[oklch(0.15_0_0)]/60 backdrop-blur-sm overflow-y-auto">
          <nav aria-label="Admin navigation" className="flex-1 py-2.5">
            <AdminNav badges={{ knoxPending, trustPending }} />
          </nav>
          <div className="border-t border-black/[0.04] dark:border-white/[0.04] px-3 py-2.5">
            <Link
              href="/"
              prefetch={false}
              className="flex items-center gap-2 text-[11px] text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors font-medium"
            >
              <ExternalLink className="size-3" strokeWidth={1.5} />
              Public site
            </Link>
          </div>
        </aside>

        {/* Main content */}
        <main id="main-content" className="admin-content flex-1 min-w-0 px-5 py-5 lg:px-7">
          <div className="mx-auto max-w-[1600px]">{children}</div>
        </main>
      </div>

      <CommandPalette />
    </div>
  );
}
