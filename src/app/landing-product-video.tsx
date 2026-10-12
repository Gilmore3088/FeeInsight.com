"use client";
import { useEffect, useRef } from "react";

/** Actual rendered walkthrough; the report frames come directly from the sample PDF. */
export function LandingProductVideo() {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      if (!video.current) return;
      if (preference.matches) video.current.pause();
      else void video.current.play().catch(() => { /* Native controls remain available. */ });
    };
    apply();
    preference.addEventListener("change", apply);
    return () => preference.removeEventListener("change", apply);
  }, []);
  return <video ref={video} controls muted loop playsInline preload="metadata"
    poster="/videos/hamilton-question-to-report-v2.jpg"
    aria-label="Hamilton walkthrough: ask a question, explore sample findings, and create a report"
    className="aspect-video w-full rounded-xl border border-[#E0D7C9] bg-[#FAF7F2] shadow-lg">
    <source src="/videos/hamilton-question-to-report-v2.mp4" type="video/mp4" />
    <track kind="captions" src="/videos/hamilton-question-to-report-v2.vtt" srcLang="en" label="English" />
    Your browser cannot play this video. <a href="/videos/hamilton-question-to-report-v2.mp4">Download the walkthrough.</a>
  </video>;
}
