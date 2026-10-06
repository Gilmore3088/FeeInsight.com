"use client";

import Image from "next/image";
import { useState } from "react";
import { trackEvent } from "@/lib/analytics";

const VIDEO_SRC = "/video/fee-insight-60s.mp4";
const POSTER_SRC = "/video/fee-insight-60s-poster.webp";
const CAPTIONS_SRC = "/video/fee-insight-60s.vtt";

/**
 * The 60-second Fee Insight video. Until someone presses play, the page carries only a
 * small poster image; the 2.3 MB video is fetched on the click, never on page load.
 */
export function FeeInsightVideo({ placement }: { placement: string }) {
  const [playing, setPlaying] = useState(false);

  return (
    <figure className="overflow-hidden rounded-lg border border-[#E0D7C9] bg-[#FAF7F2]">
      <div className="relative aspect-video w-full">
        {playing ? (
          <video
            className="absolute inset-0 h-full w-full"
            src={VIDEO_SRC}
            poster={POSTER_SRC}
            controls
            autoPlay
            playsInline
            preload="none"
          >
            <track kind="captions" src={CAPTIONS_SRC} srcLang="en" label="English" default />
          </video>
        ) : (
          <button
            type="button"
            onClick={() => {
              setPlaying(true);
              trackEvent("video_play", { placement });
            }}
            className="group absolute inset-0 h-full w-full cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C44B2E]"
            aria-label="Play the 60-second Fee Insight video (with sound and captions)"
          >
            <Image
              src={POSTER_SRC}
              alt=""
              fill
              sizes="(min-width: 1024px) 640px, 100vw"
              className="object-cover"
            />
            <span className="absolute inset-0 bg-[#1A1815]/10 transition-colors group-hover:bg-[#1A1815]/20" />
            <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#C44B2E] shadow-lg transition-transform group-hover:scale-105">
              <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="#fff">
                <path d="M7 4.5v15l13-7.5z" />
              </svg>
            </span>
          </button>
        )}
      </div>
      <figcaption className="flex items-center justify-between gap-3 border-t border-[#E0D7C9] bg-white px-4 py-2.5 text-[12px] text-[#5A5347]">
        <span>Fee Insight in 60 seconds</span>
        <span className="tabular-nums text-[#6B6255]">1:00 · sound and captions</span>
      </figcaption>
    </figure>
  );
}
