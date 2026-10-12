import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { ROOMS } from "@/lib/admin-rooms";
import { RoomHeader } from "../room-hub";

export const dynamic = "force-dynamic";

/**
 * The "Your work" room (#1122): what only James can do. Its screens are listed here and in the
 * room menu. The counts and oldest item per pile come with the Your work step of the redesign.
 */
export default async function YourWorkPage() {
  await requireAuth("view");
  const room = ROOMS.find((candidate) => candidate.key === "work")!;
  const screens = room.pages.filter((page) => page.href !== room.href);
  return (
    <div className="space-y-8 pb-10">
      <RoomHeader room="work" />
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {screens.map((page) => (
          <li key={page.href}>
            <Link href={page.href} prefetch={false} className="admin-card block space-y-1 p-4 hover:border-[var(--brand-primary)]">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{page.label}</p>
              <p className="text-xs text-gray-500">{page.role}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
