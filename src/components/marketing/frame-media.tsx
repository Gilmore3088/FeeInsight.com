"use client";

import { useState, type ReactNode } from "react";

/** A recorded clip that can stand in for a live exhibit once one is approved (brief 06 §4.1). */
export interface FrameVideo {
  src: string;
  poster?: string;
  /** What the button says, e.g. "Watch the tour". */
  label: string;
}

/**
 * Where a recorded tour will go, until one is approved: a 16:9 navy poster with a play mark
 * and its caption. It is a picture, not a control, so it has no button role and does nothing
 * on a click. Once a clip exists, `FrameMedia` shows the real button instead.
 */
export function FramePlaceholder({ caption, className = "" }: { caption: string; className?: string }) {
  return (
    <div
      data-video-placeholder=""
      className={`relative flex aspect-video w-full select-none flex-col items-center justify-center gap-2 overflow-hidden rounded-xl bg-ink text-on-ink shadow-fi-2 ${className}`}
    >
      <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-on-ink/15 ring-1 ring-on-ink/30">
        <svg viewBox="0 0 12 12" className="ml-0.5 h-3.5 w-3.5">
          <path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />
        </svg>
      </span>
      <span className="whitespace-nowrap px-3 text-center text-[12px] font-semibold leading-4">{caption}</span>
    </div>
  );
}

/**
 * The live exhibit, with an optional recorded clip behind a button. With no clip there is
 * no button at all, so the page never shows a control that does nothing. The clip loads
 * only once the reader asks for it.
 */
export function FrameMedia({
  video,
  onOpen,
  children,
}: {
  video?: FrameVideo | null;
  onOpen?: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!video?.src) return <>{children}</>;
  return (
    <div className="relative">
      <div className={open ? "invisible" : undefined} aria-hidden={open || undefined}>
        {children}
      </div>
      {open ? (
        <video
          className="absolute inset-0 h-full w-full bg-ink object-contain"
          src={video.src}
          poster={video.poster}
          controls
          autoPlay
          muted
          playsInline
          preload="none"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            onOpen?.();
          }}
          className="absolute bottom-3 right-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-ink px-4 text-[13px] font-semibold text-on-ink shadow-fi-2"
        >
          <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
            <path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />
          </svg>
          {video.label}
        </button>
      )}
    </div>
  );
}
