import type { ReactNode } from "react";

/** One section of the account page: a serif heading, an optional one-line note, then the body. */
export function AccountCard({
  id,
  title,
  note,
  action,
  children,
}: {
  id: string;
  title: string;
  note?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="scroll-mt-24 rounded-xl border border-[#E8DFD1] bg-white/70 p-5"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id={headingId}
            className="text-[19px] font-medium leading-tight text-[#1A1815]"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
          >
            {title}
          </h2>
          {note && <p className="mt-1 text-[13px] text-[#6B6255]">{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
