import type { Metadata } from "next";
import { NotFoundContent } from "@/components/public/not-found-content";
import { ConsumerNav } from "@/components/consumer-nav";
import { CustomerFooter } from "@/components/customer-footer";
import { SearchModal } from "@/components/public/search-modal";

// Without this the tab kept the home page's title on a dead link.
export const metadata: Metadata = {
  title: "Page not found",
};

/** Outside the public layout: supplies its own nav, main landmark, footer and ground. */
export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <ConsumerNav />
      <main id="main-content">
        <NotFoundContent />
      </main>
      <CustomerFooter />
      <SearchModal />
    </div>
  );
}
