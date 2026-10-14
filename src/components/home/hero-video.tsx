"use client";

import { useRef, useState } from "react";
import { trackEvent } from "@/lib/analytics";

/** The 30-second walkthrough in the Index look, rendered from docs/design/homepage-v2/video. */
export const WALKTHROUGH_VIDEO = {
  src: "/videos/hamilton-walkthrough.mp4",
  poster: "/videos/hamilton-walkthrough-poster.webp",
  captions: "/videos/hamilton-walkthrough.vtt",
  width: 1920,
  height: 1080,
} as const;

const VIDEO_LABEL =
  "Thirty-second walkthrough: a question to Hamilton, the findings, and the sample report it produces";

/**
 * Muted, inline, no autoplay: the poster frame shows until the visitor presses the play
 * button, so nothing downloads before they ask. After the first play the native controls
 * take over, so pause, scrubbing and captions stay available from the keyboard.
 */
export function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  function play() {
    const video = videoRef.current;
    if (!video) return;
    setStarted(true);
    trackEvent("see_sample_report", { placement: "home_hero_video" });
    void video.play().catch(() => {
      /* The native controls remain; the visitor can press play there. */
    });
  }

  return (
    <div className="relative overflow-hidden rounded-[8px] border border-index-line bg-index-navy shadow-[0_24px_48px_-24px_rgba(14,26,43,0.45)]">
      <video
        ref={videoRef}
        muted
        playsInline
        preload="none"
        controls={started}
        poster={WALKTHROUGH_VIDEO.poster}
        width={WALKTHROUGH_VIDEO.width}
        height={WALKTHROUGH_VIDEO.height}
        aria-label={VIDEO_LABEL}
        className="block aspect-video h-auto w-full"
        onEnded={() => setStarted(false)}
      >
        <source src={WALKTHROUGH_VIDEO.src} type="video/mp4" />
        <track kind="captions" src={WALKTHROUGH_VIDEO.captions} srcLang="en" label="English" default />
        Your browser cannot play this video. <a href={WALKTHROUGH_VIDEO.src}>Download the walkthrough.</a>
      </video>
      {!started && (
        <button
          type="button"
          onClick={play}
          aria-label="Play the 30-second walkthrough"
          className="group absolute inset-0 flex items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-index-green-bright"
        >
          <span className="flex min-h-16 min-w-16 items-center justify-center rounded-full bg-white text-index-navy shadow-[0_8px_24px_rgba(14,26,43,0.35)] transition-transform group-hover:scale-105">
            <svg viewBox="0 0 24 24" className="ml-1 h-7 w-7" fill="currentColor" aria-hidden="true">
              <path d="M7 4.5v15l13-7.5z" />
            </svg>
          </span>
          <span className="absolute bottom-3 left-3 rounded-[4px] bg-index-navy/85 px-2 py-1 font-mono text-[12px] text-white">
            0:30
          </span>
        </button>
      )}
    </div>
  );
}
