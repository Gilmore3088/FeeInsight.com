import localFont from "next/font/local";

/**
 * The homepage's headline serif (James, Oct 17: "Restore the serif treatment on major
 * headlines"): Newsreader, the site's own self-hosted serif in public/fonts, loaded for the
 * homepage only. The h1 and the section h2s read it through SERIF (landing-shared.tsx).
 */
export const homeSerif = localFont({
  src: "../../public/fonts/newsreader-variable.ttf",
  variable: "--fi-home-serif",
  weight: "300 600",
  style: "normal",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
});
