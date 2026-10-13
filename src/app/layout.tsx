import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import { SITE_URL } from "@/lib/constants";
import { MarketingTouchRecorder } from "@/components/public/marketing-touch-recorder";
import "./globals.css";

// Keep the same families locally: Google's extensionless font URLs can break
// next/font's production parser before a preview can be built.
const newsreader = localFont({
  src: [
    { path: "../../public/fonts/newsreader-variable.ttf", weight: "300 600", style: "normal" },
    { path: "../../public/fonts/newsreader-italic-variable.ttf", weight: "300 600", style: "italic" },
  ],
  adjustFontFallback: "Times New Roman",
  variable: "--font-newsreader",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: [{ path: "../../public/fonts/jetbrains-mono-variable.ttf", weight: "300 700", style: "normal" }],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: "./" },
  title: {
    default: "Fee Insight — Bank and credit union fees, traced to the source",
    template: "%s | Fee Insight",
  },
  description:
    "Fee Insight's Bank Fee Index: find bank and credit union fees by district, state, size, and type. Research-grade, source-verified fee intelligence.",
  openGraph: {
    type: "website",
    siteName: "Fee Insight",
  },
  twitter: {
    card: "summary_large_image",
  },
  // Search Console ownership: paste Google's HTML-tag code into the
  // GOOGLE_SITE_VERIFICATION env var in Vercel. Unset renders no tag.
  ...(process.env.GOOGLE_SITE_VERIFICATION?.trim()
    ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION.trim() } }
    : {}),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${GeistSans.variable} ${GeistMono.variable} ${newsreader.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        {children}
        {/* Records a tracked-link visit (utm_ tags) once per session; no personal data. */}
        <MarketingTouchRecorder />
        {/* Vercel injects /_vercel/insights only on its own platform; elsewhere the script 404s. */}
        {process.env.VERCEL ? <Analytics /> : null}
      </body>
    </html>
  );
}
