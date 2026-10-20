import type { Metadata } from "next";
import { LinkButton, MemoHeader, MemoPage } from "@/components/hamilton/memo/memo";

export const metadata: Metadata = {
  title: "Page not found",
};

/**
 * A notFound() from any Hamilton page (a saved report, analysis or scenario that doesn't exist or
 * isn't yours) renders here, inside the Hamilton shell, instead of the consumer 404.
 */
export default function HamiltonNotFound() {
  return (
    <MemoPage width="reading">
      <MemoHeader
        kicker="404"
        title="We couldn't find that page"
        dek="The link may be old, or the report, analysis or scenario it opens was deleted. Saved work opens only in the account that saved it."
        actions={
          <>
            <LinkButton href="/pro/hamilton" primary>
              Back to This month
            </LinkButton>
            <LinkButton href="/pro/saved">Saved analyses</LinkButton>
          </>
        }
      />
    </MemoPage>
  );
}
