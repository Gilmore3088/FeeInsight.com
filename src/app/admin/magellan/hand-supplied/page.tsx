import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireAuth } from "@/lib/auth";
import { HUNT_STATUSES } from "@/lib/agents/magellan/hand-supplied-files";
import { HandSuppliedForm } from "./upload-form";

export const dynamic = "force-dynamic";

export default async function HandSuppliedPage() {
  await requireAuth("edit");
  return (
    <div className="space-y-6">
      <header>
        <Breadcrumbs
          items={[{ label: "Atlas", href: "/admin" }, { label: "Magellan", href: "/admin/magellan" }, { label: "Hand-supplied schedules" }]}
        />
        <p className="admin-eyebrow mt-3">Agent · Discover</p>
        <h1 className="admin-display-title mt-1">Hand-supplied schedules</h1>
        <p className="admin-lede mt-2">
          Fee schedules a person downloaded from the bank&rsquo;s own site, for banks whose site blocks our fetcher or
          where we hold the wrong page. Each PDF is stored as a document of its institution and read straight away;
          Knox, Darwin and Hamilton take it from there. Nothing on file is replaced, and the bank&rsquo;s site is not
          asked for the file again.
        </p>
      </header>
      <section className="space-y-2 text-sm text-ink-muted">
        <p>
          Name each file <code>&lt;institution_id&gt;__&lt;short-name&gt;__consumer.pdf</code>. Business schedules
          (<code>__business.pdf</code>) are not loaded: the index reads consumer schedules.
        </p>
        <p>
          Add the browser hunt CSV with the files. Each file takes its <code>found_url</code>, <code>effective_date</code>{" "}
          and <code>notes</code> from the row that names it in <code>file_name</code> (or the one found row for its
          institution). A file with no <code>found_url</code> is not stored. Rows marked{" "}
          <code>FOUND_PDF</code> or <code>FOUND_PAGE</code> with no file become hand-found links, fetched on a later tick.
          Other statuses ({HUNT_STATUSES.filter((status) => !status.startsWith("FOUND")).join(", ")}) are only counted.
        </p>
        <p>The same file twice for one institution changes nothing. Every load is a Magellan run in the ledger.</p>
      </section>
      <HandSuppliedForm />
    </div>
  );
}
