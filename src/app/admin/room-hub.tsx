import Link from "next/link";
import { ROOMS, type RoomKey } from "@/lib/admin-rooms";

/** A room's landing header: its name and the question it answers. */
export function RoomHeader({ room: key, children }: { room: RoomKey; children?: React.ReactNode }) {
  const room = ROOMS.find((candidate) => candidate.key === key)!;
  return (
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-gray-500">{room.label}</p>
        <h1 className="admin-display-title mt-2">{room.question}</h1>
      </div>
      {children}
    </header>
  );
}

/** Every other screen in the room, as cards. */
export function RoomScreens({ room: key }: { room: RoomKey }) {
  const room = ROOMS.find((candidate) => candidate.key === key)!;
  const pages = room.pages.filter((page) => page.href !== room.href);
  if (pages.length === 0) return null;
  return (
    <section aria-label={`${room.label} screens`}>
      <p className="admin-section-title">Screens in {room.label}</p>
      <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {pages.map((page) => (
          <li key={page.href}>
            <Link
              href={page.href}
              prefetch={false}
              className="admin-card block h-full px-3 py-2.5 transition-colors hover:border-gray-300 dark:hover:border-white/15"
            >
              <span className="block text-[13px] font-semibold text-gray-900 dark:text-gray-100">{page.label}</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">{page.role}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Unreadable({ what }: { what: string }) {
  return (
    <p
      role="status"
      className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200"
    >
      {what} could not be read; check the database connection.
    </p>
  );
}
