/**
 * The merger screen as a page: cover with headline figures, then five exhibits, in the shared
 * report design (src/components/report-design). Everything shown comes from
 * buildMergerScreen (src/lib/hamilton/studies-exhibits/merger.ts); chart SVG is generated
 * there from escaped data. Server component, no client code.
 */
import { ReportDocument } from "@/components/report-design";
import { mergerDocument, type MergerScreen } from "@/lib/hamilton/studies-exhibits/merger";

export function MergerScreenView({ screen }: { screen: MergerScreen }) {
  return <ReportDocument doc={mergerDocument(screen)} />;
}
