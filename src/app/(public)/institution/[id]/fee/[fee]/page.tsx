import { notFound } from "next/navigation";

// The proxy redirects recognized legacy URLs while preserving the query string.
// Do not render another copy of the profile here; unknown fee paths stay 404.
export default function RetiredInstitutionFeePage() {
  notFound();
}
