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

/** The title of a screen inside a room, for pages that had their name only in an old tab bar. */
export function ScreenHeader({ title, lede }: { title: string; lede?: string }) {
  return (
    <header>
      <h1 className="admin-display-title">{title}</h1>
      {lede ? <p className="admin-lede mt-1.5 max-w-3xl">{lede}</p> : null}
    </header>
  );
}
