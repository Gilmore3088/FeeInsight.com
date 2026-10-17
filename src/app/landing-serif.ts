import localFont from "next/font/local";

/**
 * The homepage's headline serif (James, Oct 17: "Restore the serif treatment on major
 * headlines"): Newsreader, the site's own serif, loaded for the homepage only. The file is a
 * Latin subset at the one weight the headings use (500), about 12 KB (public/fonts/README.md).
 * Until it loads, the headings show a size-matched Times New Roman, so the swap is serif to serif.
 * The h1 and the section h2s read it through SERIF (landing-shared.tsx).
 */
export const homeSerif = localFont({
  src: "../../public/fonts/newsreader-latin-500.woff2",
  variable: "--fi-home-serif",
  weight: "500",
  style: "normal",
  display: "swap",
  adjustFontFallback: "Times New Roman",
  fallback: ["Georgia", "Times New Roman", "serif"],
});
