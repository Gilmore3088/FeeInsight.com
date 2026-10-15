import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Analytics } from "@vercel/analytics/next";
import { SITE_URL } from "@/lib/constants";
import { MarketingTouchRecorder } from "@/components/public/marketing-touch-recorder";
import "./globals.css";

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
    // Resolved against each page's own path, like the canonical above.
    url: "./",
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

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3efe6" },
    { media: "(prefers-color-scheme: dark)", color: "#132338" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The font variables sit on <html> so tokens declared on :root (--fi-font-sans, --font-sans) can read them.
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="bg-paper text-ink font-sans antialiased">
        {children}
        {/* Records a tracked-link visit (utm_ tags) once per session; no personal data. */}
        <MarketingTouchRecorder />
        {/* Vercel injects /_vercel/insights only on its own platform; elsewhere the script 404s. */}
        {process.env.VERCEL ? <Analytics /> : null}
      </body>
    </html>
  );
}
