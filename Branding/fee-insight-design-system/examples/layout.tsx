// Example: app/layout.tsx in a Next.js App Router project.
// Adjust the import paths to wherever you place this package (e.g. src/brand/).
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "@/brand/tokens/tokens.css";
import "@/brand/styles/fee-insight.css";
import "./globals.css"; // Tailwind entry (see README: Tailwind v3 or v4)

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", weight: ["400", "500", "600", "700", "800"] });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: { default: "Bank Fee Index", template: "%s · Bank Fee Index" },
  icons: { icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/icon.svg", type: "image/svg+xml" }], apple: "/apple-touch-icon.png" },
  manifest: "/site.webmanifest",
  openGraph: { images: [{ url: "/brand/og/og-bank-fee-index.png", width: 1200, height: 630 }] },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3efe6" },
    { media: "(prefers-color-scheme: dark)", color: "#132338" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="fi-root bg-paper text-ink font-sans">{children}</body>
    </html>
  );
}
