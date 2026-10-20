import Link from "next/link";
import { UtilityFootnote, UtilityHeading, UtilityShell } from "@/components/utility/utility-shell";
import { UTILITY_QUIET_LINK } from "@/components/utility/form-style";

/** The single-column shell the password pages share: logo, heading, form. */
export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <UtilityShell>
      <UtilityHeading title={title} />
      {children}
      <UtilityFootnote>
        <Link href="/login" className={UTILITY_QUIET_LINK}>
          Back to sign in
        </Link>
      </UtilityFootnote>
    </UtilityShell>
  );
}
