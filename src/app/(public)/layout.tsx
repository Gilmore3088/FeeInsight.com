import { ConsumerNav } from "@/components/consumer-nav";
import { CustomerFooter } from "@/components/customer-footer";
import { SearchModal } from "@/components/public/search-modal";
import { AdminViewBanner } from "@/components/admin-view-banner";

/**
 * Public chrome. Deliberately reads no session on the server: a layout that reads
 * cookies makes every page beneath it dynamic, which would silently undo the static
 * rendering of the consumer guides. Session-dependent chrome — the staff banner and the
 * account corner of the nav — is rendered by client islands after hydration.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <AdminViewBanner />
      <ConsumerNav />
      <main>{children}</main>
      <CustomerFooter />
      <SearchModal />
    </div>
  );
}
