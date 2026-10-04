"use client";

import { HamiltonErrorState } from "@/components/hamilton/layout/HamiltonErrorState";

export default function ProError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <HamiltonErrorState {...props} />;
}
