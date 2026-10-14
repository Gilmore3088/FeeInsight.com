import type { ReactNode } from "react";

/**
 * One part of a scene that arrives at `at` ms into the scene: a slow fade and a short rise.
 * Driven by the scene clock rather than CSS delays, so a paused or picked scene shows every
 * part at once and never sits blank.
 */
export function Reveal({
  at,
  t,
  children,
  className = "",
}: {
  at: number;
  t: number;
  children: ReactNode;
  className?: string;
}) {
  const shown = t >= at;
  return (
    <div
      className={`min-w-0 transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none ${
        shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      } ${className}`}
    >
      {children}
    </div>
  );
}
