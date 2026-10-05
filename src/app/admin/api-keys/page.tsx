export const dynamic = "force-dynamic";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireAuth } from "@/lib/auth";
import { listApiKeys, type ApiKeyRow } from "@/lib/api-keys";
import { CreateKeyForm } from "./create-key-form";
import { revokeApiKeyAction } from "./actions";

const TIER_LABELS: Record<string, string> = {
  enterprise: "Unlimited",
  pro: "10,000 / month",
  free: "100 / month",
};

function time(value: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

async function loadKeys(): Promise<{ keys: ApiKeyRow[]; error: string | null }> {
  try {
    return { keys: await listApiKeys(), error: null };
  } catch (error) {
    console.error("API key listing failed", error);
    return {
      keys: [],
      error:
        "Keys could not be loaded. Run supabase/migrations/20270103000000_api_key_tier_and_revocation.sql in the Supabase SQL editor first.",
    };
  }
}

export default async function ApiKeysPage() {
  await requireAuth("manage_users");
  const { keys, error } = await loadKeys();

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Atlas", href: "/admin" },
          { label: "API Trust", href: "/admin/api-trust" },
          { label: "API Keys" },
        ]}
      />

      <section className="space-y-4 rounded-lg border border-black/[0.06] bg-white p-5 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.03]">
        <div>
          <p className="admin-eyebrow">Control · API Keys</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-gray-950 dark:text-gray-50">
            Give a partner access to the fee data
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-400">
            A key lets another website pull from <code>/api/v1</code>. Send the key together with the docs
            link (<code>/api-docs</code>). Revoking a key switches that partner off immediately.
          </p>
        </div>
        <CreateKeyForm />
      </section>

      <section className="rounded-lg border border-black/[0.06] bg-white shadow-sm dark:border-white/[0.06] dark:bg-white/[0.03]">
        <div className="border-b border-black/[0.06] px-5 py-3 dark:border-white/[0.06]">
          <h2 className="text-sm font-semibold text-gray-950 dark:text-gray-100">Issued keys</h2>
        </div>
        {error ? (
          <p className="px-5 py-4 text-sm text-red-700 dark:text-red-300">{error}</p>
        ) : keys.length === 0 ? (
          <p className="px-5 py-4 text-sm text-gray-500">No keys issued yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-[0.1em] text-gray-500">
                <tr>
                  <th className="px-5 py-2">Partner</th>
                  <th className="px-5 py-2">Key</th>
                  <th className="px-5 py-2">Allowance</th>
                  <th className="px-5 py-2">Created</th>
                  <th className="px-5 py-2">Last used</th>
                  <th className="px-5 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id} className="border-t border-black/[0.04] dark:border-white/[0.04]">
                    <td className="px-5 py-2">
                      <div className="font-medium text-gray-900 dark:text-gray-100">{key.organization_name}</div>
                      <div className="text-xs text-gray-500">{key.name}</div>
                    </td>
                    <td className="px-5 py-2 font-mono text-xs">{key.key_prefix}…</td>
                    <td className="px-5 py-2">{TIER_LABELS[key.tier] ?? key.tier}</td>
                    <td className="px-5 py-2 tabular-nums">{time(key.created_at)}</td>
                    <td className="px-5 py-2 tabular-nums">{time(key.last_used_at)}</td>
                    <td className="px-5 py-2">
                      {key.revoked_at ? (
                        <span className="text-xs text-gray-500">Revoked {time(key.revoked_at)}</span>
                      ) : (
                        <form action={revokeApiKeyAction}>
                          <input type="hidden" name="key_id" value={key.id} />
                          <button
                            type="submit"
                            className="rounded-md border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 dark:border-red-900 dark:text-red-300"
                          >
                            Revoke
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
