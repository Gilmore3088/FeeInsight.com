import { redirect } from "next/navigation";

/**
 * /pro is the workspace entry point. The Pro layout already sends signed-out users to
 * login and non-subscribers to /subscribe, so subscribers land on the Benchmark screen.
 */
export default function ProIndexPage() {
  redirect("/pro/hamilton");
}
