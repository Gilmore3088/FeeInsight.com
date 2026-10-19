import localFont from "next/font/local";

/**
 * The profile's headline serif (James, Oct 17: serif on major headlines, as on the homepage):
 * Newsreader, the site's self-hosted serif in public/fonts. Loaded by page.tsx only, so the
 * components that read SERIF stay importable in unit tests.
 */
export const profileSerif = localFont({
  src: "../../../../../public/fonts/newsreader-variable.ttf",
  variable: "--fi-profile-serif",
  weight: "300 600",
  style: "normal",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
});
