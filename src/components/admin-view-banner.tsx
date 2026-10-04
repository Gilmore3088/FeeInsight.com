"use client";

import Link from "next/link";
import { useSessionChrome } from "./use-session-chrome";

/** "Viewing as admin" strip above the public chrome. Client-rendered so the layout stays static. */
export function AdminViewBanner() {
  const session = useSessionChrome();
  if (!session?.isStaff) return null;
  return (
    <div className="bg-gray-900 text-white text-xs px-4 py-1.5 flex items-center justify-between">
      <span className="text-gray-400">
        Viewing as {session.role ?? "admin"} — this is the public consumer view
      </span>
      <Link href="/admin" className="text-blue-400 hover:text-blue-300 font-medium">
        Back to Admin
      </Link>
    </div>
  );
}
