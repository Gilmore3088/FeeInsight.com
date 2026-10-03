import { NotFoundContent } from "@/components/public/not-found-content";

/** Outside the public layout: supplies its own main landmark and ground. */
export default function NotFound() {
  return (
    <main id="main-content" className="min-h-screen bg-[#FAF7F2]">
      <NotFoundContent />
    </main>
  );
}
