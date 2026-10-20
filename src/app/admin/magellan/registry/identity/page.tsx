import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireAuth } from "@/lib/auth";
import { IDENTITY_REVIEW_BULK_LIMIT } from "@/lib/agents/magellan/registry/identity";
import {
  getIdentityLinkCandidates,
  IDENTITY_LINK_PAGE_SIZE,
  IDENTITY_LINK_STATUSES,
  listIdentityLinks,
  searchInstitutionsForIdentityLink,
  type IdentityInstitution,
  type IdentityLinkRow,
  type IdentityLinkStatus,
} from "@/lib/data-store/registry-profile";
import {
  acceptIdentityLinkAction,
  bulkDecideIdentityLinksAction,
  rejectIdentityLinkAction,
  resetIdentityLinkAction,
} from "./actions";

export const dynamic = "force-dynamic";

const PAGE = "/admin/magellan/registry/identity";
const STATUS_LABELS: Record<IdentityLinkStatus, string> = { needs_review: "Waiting for review", accepted: "Accepted", rejected: "Rejected" };
const TYPE_LABELS = { cfpb_company: "CFPB complaints", sec_cik: "SEC filer" } as const;
const BUTTON = "rounded-md border border-[var(--admin-border,#ddd5c6)] px-2 py-1 text-xs font-medium hover:bg-black/5";
const INPUT = "rounded-md border border-[var(--admin-border,#ddd5c6)] bg-transparent px-2 py-1 text-sm";

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined): string | null => (Array.isArray(value) ? value[0] : value)?.trim() || null;

/** asset_size is in thousands of dollars. */
function formatAssets(thousands: number | null): string {
  if (thousands === null || !Number.isFinite(thousands) || thousands <= 0) return "Assets unknown";
  const dollars = thousands * 1000;
  if (dollars >= 1e9) return `$${(dollars / 1e9).toFixed(dollars >= 1e11 ? 0 : 1)}B assets`;
  return `$${Math.round(dollars / 1e6).toLocaleString("en-US")}M assets`;
}

function outboundUrl(row: IdentityLinkRow): string {
  return row.linkType === "sec_cik"
    ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(row.externalKey)}`
    : `https://www.consumerfinance.gov/data-research/consumer-complaints/search/?company=${encodeURIComponent(row.externalKey)}`;
}

function InstitutionSummary({ institution }: { institution: IdentityInstitution }) {
  const place = [institution.city, institution.state].filter(Boolean).join(", ");
  const ids = [institution.rssd && `RSSD ${institution.rssd}`, institution.cert && `cert ${institution.cert}`].filter(Boolean).join(" · ");
  return (
    <div className="min-w-0">
      <a className="font-medium underline" href={`/admin/institution/${institution.id}`}>
        {institution.name}
      </a>
      <p className="text-xs text-ink-muted">
        {[place, institution.charter, formatAssets(institution.assets)].filter(Boolean).join(" · ")}
      </p>
      {institution.holdingCompany && <p className="text-xs text-ink-muted">Parent: {institution.holdingCompany}</p>}
      {ids && <p className="text-xs text-ink-muted">{ids}</p>}
    </div>
  );
}

function PickList({ row, institutions, back, empty }: { row: IdentityLinkRow; institutions: IdentityInstitution[]; back: string; empty: string }) {
  if (institutions.length === 0) return <p className="mt-2 text-sm text-ink-muted">{empty}</p>;
  return (
    <ul className="mt-2 space-y-2">
      {institutions.map((institution) => (
        <li key={institution.id} className="flex flex-col gap-2 border-t border-black/5 pt-2 sm:flex-row sm:items-start sm:justify-between">
          <InstitutionSummary institution={institution} />
          <form action={acceptIdentityLinkAction} className="shrink-0">
            <input type="hidden" name="linkId" value={row.id} />
            <input type="hidden" name="institutionId" value={institution.id} />
            <input type="hidden" name="back" value={back} />
            <button type="submit" className={BUTTON}>
              {institution.id === row.institution?.id ? "Accept this one" : "Point here and accept"}
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}

async function Picker({ row, find, hrefFor, back }: { row: IdentityLinkRow; find: string | null; hrefFor: (changes: Params) => string; back: string }) {
  const [candidates, found] = await Promise.all([
    getIdentityLinkCandidates(row.id).catch((): IdentityInstitution[] => []),
    find ? searchInstitutionsForIdentityLink(find).catch((): IdentityInstitution[] => []) : Promise.resolve(null),
  ]);
  return (
    <div className="mt-3 rounded-md border border-[var(--admin-border,#ddd5c6)] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">Candidates for this name ({candidates.length})</p>
        <Link className="text-xs underline" href={hrefFor({ pick: undefined, find: undefined })}>
          Close
        </Link>
      </div>
      <PickList row={row} institutions={candidates} back={back} empty="No institution carries this name today. Search below." />
      <form method="GET" action={PAGE} className="mt-3 flex flex-col gap-2 sm:flex-row">
        {[...new URL(hrefFor({ find: undefined }), "http://admin.local").searchParams].map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        <input
          type="search"
          name="find"
          defaultValue={find ?? ""}
          placeholder="Name, FDIC cert, RSSD or NCUA charter"
          aria-label="Find another institution"
          className={`${INPUT} min-w-0 flex-1`}
        />
        <button type="submit" className={BUTTON}>
          Find
        </button>
      </form>
      {found && <PickList row={row} institutions={found} back={back} empty="No institution matches that search." />}
    </div>
  );
}

export default async function IdentityReviewPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAuth("operate");
  const params = await searchParams;
  const statusParam = one(params.status);
  const status: IdentityLinkStatus = (IDENTITY_LINK_STATUSES as readonly string[]).includes(statusParam ?? "")
    ? (statusParam as IdentityLinkStatus)
    : "needs_review";
  const typeParam = one(params.type);
  const linkType = typeParam === "cfpb_company" || typeParam === "sec_cik" ? typeParam : null;
  const query = one(params.q)?.slice(0, 200) ?? null;
  const page = Math.max(1, Math.min(10_000, Number.parseInt(one(params.page) ?? "1", 10) || 1));
  const pick = Number.parseInt(one(params.pick) ?? "", 10) || null;
  const find = one(params.find)?.slice(0, 120) ?? null;
  const message = one(params.msg);

  const base: Params = { status: status === "needs_review" ? undefined : status, type: linkType ?? undefined, q: query ?? undefined, page: page > 1 ? String(page) : undefined };
  const hrefFor = (changes: Params): string => {
    const merged = { ...base, pick: pick ? String(pick) : undefined, find: find ?? undefined, ...changes };
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) if (typeof value === "string" && value) search.set(key, value);
    const text = search.toString();
    return text ? `${PAGE}?${text}` : PAGE;
  };
  const back = hrefFor({ pick: undefined, find: undefined });

  const { rows, total } = await listIdentityLinks({ status, linkType, query, page }).catch(() => ({ rows: [] as IdentityLinkRow[], total: 0 }));
  const pages = Math.max(1, Math.ceil(total / IDENTITY_LINK_PAGE_SIZE));

  return (
    <div className="space-y-6">
      <header>
        <Breadcrumbs
          items={[
            { label: "Atlas", href: "/admin" },
            { label: "Hoovie" },
            { label: "Regulatory registry", href: "/admin/magellan/registry" },
            { label: "Identity matches" },
          ]}
        />
        <p className="admin-eyebrow mt-3">Hoovie · Regulatory registry</p>
        <h1 className="admin-display-title mt-1">Identity matches</h1>
        <p className="admin-lede mt-2">
          CFPB complaint companies and SEC filers matched to our institutions by name. Only accepted links are used for
          data, on the next registry run. Your decision is kept: later matcher runs never change it until you send it
          back for review. Accepting a CFPB company re-queues past complaint years so its history loads.
        </p>
      </header>

      {message && (
        <p role="status" className="admin-card text-sm">
          {message}
        </p>
      )}

      <form method="GET" action={PAGE} className="admin-card flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="flex flex-col text-xs text-ink-muted">
          Status
          <select name="status" defaultValue={status} className={INPUT}>
            {IDENTITY_LINK_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-ink-muted">
          Source
          <select name="type" defaultValue={linkType ?? ""} className={INPUT}>
            <option value="">CFPB and SEC</option>
            <option value="cfpb_company">{TYPE_LABELS.cfpb_company}</option>
            <option value="sec_cik">{TYPE_LABELS.sec_cik}</option>
          </select>
        </label>
        <label className="flex min-w-0 flex-1 flex-col text-xs text-ink-muted">
          Name
          <input type="search" name="q" defaultValue={query ?? ""} placeholder="Company or filer name" className={INPUT} />
        </label>
        <button type="submit" className={BUTTON}>
          Show
        </button>
      </form>

      <section className="admin-card">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold">
            {STATUS_LABELS[status]} ({total.toLocaleString("en-US")})
          </h2>
          {rows.length > 0 && (
            <form id="bulk" action={bulkDecideIdentityLinksAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="back" value={back} />
              <span className="text-xs text-ink-muted">Ticked rows (up to {IDENTITY_REVIEW_BULK_LIMIT}), each at its shown institution:</span>
              <button type="submit" name="decision" value="accept" className={BUTTON}>
                Accept ticked
              </button>
              <button type="submit" name="decision" value="reject" className={BUTTON}>
                Reject ticked
              </button>
            </form>
          )}
        </div>
        {status === "needs_review" && (
          <p className="mt-1 text-xs text-ink-muted">Most complaints first, then names shared by the most institutions.</p>
        )}

        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">Nothing here.</p>
        ) : (
          <ul className="mt-3">
            {rows.map((row) => (
              <li key={row.id} className="border-t border-black/5 py-3">
                <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <input
                    type="checkbox"
                    form="bulk"
                    name="linkId"
                    value={row.id}
                    aria-label={`Select ${row.externalName ?? row.externalKey}`}
                    className="mt-1"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{TYPE_LABELS[row.linkType]}</p>
                    <a className="break-words font-medium underline" href={outboundUrl(row)} target="_blank" rel="noreferrer">
                      {row.externalName ?? row.externalKey}
                    </a>
                    {row.linkType === "sec_cik" && <p className="text-xs text-ink-muted">CIK {row.externalKey}</p>}
                    <p className="text-xs text-ink-muted">
                      {row.complaints
                        ? `${row.complaints.count.toLocaleString("en-US")} complaints in ${row.complaints.year}`
                        : row.ticker
                          ? `${row.ticker}${row.exchange ? ` · ${row.exchange}` : ""}`
                          : null}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {row.method} · confidence {row.confidence.toFixed(2)}
                      {row.candidates !== null ? ` · ${row.candidates} candidate${row.candidates === 1 ? "" : "s"}` : ""}
                    </p>
                    {row.verifiedBy && (
                      <p className="text-xs text-ink-muted">
                        Decided by {row.verifiedBy}
                        {row.reviewNote ? `: ${row.reviewNote}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="col-start-2 min-w-0 sm:col-start-auto">
                    {row.institution ? <InstitutionSummary institution={row.institution} /> : <p className="text-sm text-ink-muted">No institution</p>}
                  </div>
                  <div className="col-start-2 flex flex-wrap items-start gap-2 sm:col-start-auto sm:flex-col sm:items-stretch">
                    {row.institution && row.status !== "accepted" && (
                      <form action={acceptIdentityLinkAction}>
                        <input type="hidden" name="linkId" value={row.id} />
                        <input type="hidden" name="back" value={back} />
                        <button type="submit" className={`${BUTTON} w-full`}>
                          Accept
                        </button>
                      </form>
                    )}
                    <Link className={`${BUTTON} text-center`} href={hrefFor({ pick: String(row.id), find: undefined })}>
                      {row.status === "accepted" ? "Re-point" : "Other institution"}
                    </Link>
                    {row.status !== "rejected" && (
                      <form action={rejectIdentityLinkAction} className="flex gap-1">
                        <input type="hidden" name="linkId" value={row.id} />
                        <input type="hidden" name="back" value={back} />
                        <input name="note" placeholder="Note" aria-label="Rejection note" maxLength={1000} className={`${INPUT} w-24 min-w-0 flex-1 text-xs`} />
                        <button type="submit" className={BUTTON}>
                          Reject
                        </button>
                      </form>
                    )}
                    {row.verifiedBy && (
                      <form action={resetIdentityLinkAction}>
                        <input type="hidden" name="linkId" value={row.id} />
                        <input type="hidden" name="back" value={back} />
                        <button type="submit" className={`${BUTTON} w-full`}>
                          Send back for review
                        </button>
                      </form>
                    )}
                  </div>
                </div>
                {pick === row.id && <Picker row={row} find={find} hrefFor={hrefFor} back={back} />}
              </li>
            ))}
          </ul>
        )}

        {pages > 1 && (
          <nav className="mt-3 flex items-center justify-between text-sm" aria-label="Pages">
            {page > 1 ? <Link className="underline" href={hrefFor({ page: page > 2 ? String(page - 1) : undefined, pick: undefined, find: undefined })}>Previous</Link> : <span />}
            <span className="text-xs text-ink-muted">
              Page {page} of {pages}
            </span>
            {page < pages ? <Link className="underline" href={hrefFor({ page: String(page + 1), pick: undefined, find: undefined })}>Next</Link> : <span />}
          </nav>
        )}
      </section>
    </div>
  );
}
