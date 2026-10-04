import { Info } from "lucide-react";

/**
 * A small ⓘ that reveals one explainer on tap or click. Built on <details> so it
 * works without client JS; keeps supporting sentences off the page until asked for.
 */
export function InfoTip({
  label,
  children,
  align = "left",
}: {
  /** Accessible name for the icon, e.g. "About verified fees". */
  label: string;
  children: React.ReactNode;
  /** Which edge the popover hangs from; use "right" near the right side of the screen. */
  align?: "left" | "right";
}) {
  return (
    <details className="group relative inline-block align-middle">
      <summary
        aria-label={label}
        title={label}
        className="inline-flex h-5 w-5 cursor-pointer list-none items-center justify-center rounded-full text-[#8A8072] transition-colors hover:text-[#A93D25] group-open:text-[#A93D25] [&::-webkit-details-marker]:hidden"
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </summary>
      <div
        className={`absolute top-6 z-30 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-[#E0D7C9] bg-[#FFFDF9] p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-[#5A5347] shadow-lg ${
          align === "right" ? "right-0" : "left-0"
        }`}
      >
        {children}
      </div>
    </details>
  );
}
