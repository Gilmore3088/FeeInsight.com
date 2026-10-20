"use client";

import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ErrorContent } from "@/components/public/error-content";
import "./globals.css";

/**
 * Replaces the root layout when the root itself fails, which no error.tsx can catch.
 *
 * Without it Next shows its bare "Application error: a client-side exception has occurred".
 * That is what an institution page showed on Oct 18 when its response was cut off mid-stream
 * after the function hit its time limit (#1919): the page's metadata never arrived, so the
 * root failed with "Connection closed." Now the reader gets the site's error screen. "Try again"
 * reloads the page: after a cut-off response, re-rendering the same broken payload cannot help.
 */
export default function GlobalError() {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="bg-paper text-ink font-sans antialiased">
        <main id="main-content" className="min-h-screen bg-paper">
          <ErrorContent reset={() => window.location.reload()} />
        </main>
      </body>
    </html>
  );
}
