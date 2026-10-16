import type { Metadata } from "next";
import { NotFoundContent } from "@/components/public/not-found-content";
import { SITE_NAME } from "@/lib/constants";

// A missing institution, city, article or report renders this page; without its own title
// the tab showed the site default instead of "Page not found" (#1267).
export const metadata: Metadata = {
  title: "Page not found",
};

/**
 * Inside the public layout, which provides the header, footer and main landmark.
 *
 * A record checked in a layout (institution, city, article, report) throws notFound() before
 * the shell renders, so Next sends its error shell and this page is drawn in the browser.
 * The metadata above never reaches that client render; the <title> below does (React hoists
 * it into <head>).
 */
export default function NotFound() {
  return (
    <>
      <title>{`Page not found | ${SITE_NAME}`}</title>
      <NotFoundContent />
    </>
  );
}
