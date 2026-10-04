import { redirect } from "next/navigation";

/** The legacy peer builder is retired: peer sets live in Settings. */
export default function LegacyPeersPage() {
  redirect("/pro/settings#peer-sets");
}
