"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Chat", href: "/admin/hamilton/chat" },
  { label: "Reports", href: "/admin/hamilton/reports" },
  { label: "Research", href: "/admin/hamilton/research" },
  { label: "Methodology", href: "/admin/hamilton/methodology" },
] as const;

function HamiltonTabs() {
  const pathname = usePathname();

  return (
    <div className="border-b border-gray-100 dark:border-white/[0.05] mb-6">
      <nav aria-label="Hamilton admin sections" className="flex gap-0 -mb-px">
        {TABS.map((tab) => {
          const isActive = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? "border-gray-900 text-gray-900 dark:border-gray-100 dark:text-gray-100"
                  : "border-transparent text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export default function HamiltonLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <HamiltonTabs />
      {children}
    </div>
  );
}
