"use client";

import { useState, useTransition } from "react";
import { CONTACT_EMAIL, PRODUCT_NAME, SITE_URL } from "@/lib/constants";
import { API_MONTHLY_CALLS_LABEL, API_PLANS_LABEL } from "@/lib/api-subscriber-access";
import { AccountCard } from "./account-card";
import { createAccountApiKey, revokeAccountApiKey } from "./api-key-actions";
import type { ApiUsageSummary } from "@/lib/api-usage-summary";

/** What the account page knows about the subscriber's API access. */
export type ApiAccess =
  | {
      kind: "included";
      key: { prefix: string; createdAt: string; lastUsedAt: string | null } | null;
      /** The plan's shared monthly allowance and who used it; absent when it could not be read. */
      usage?: ApiUsageSummary | null;
    }
  | { kind: "upgrade" };

const BUTTON =
  "inline-flex min-h-10 items-center rounded-md border border-border bg-surface-0 px-4 text-[14px] font-medium text-ink hover:border-ink disabled:opacity-50";

function count(value: number): string {
  return value.toLocaleString("en-US");
}

/** This month's calls against the plan's shared allowance, split by person when more than one has used it. */
function UsageLine({ usage }: { usage: ApiUsageSummary }) {
  return (
    <div className="mt-3 text-[14px] text-ink">
      <p>
        Calls used this month: {count(usage.used)} of {count(usage.allowance)}
      </p>
      {usage.people.length > 1 && (
        <ul className="mt-1 space-y-0.5 text-[13px] text-ink-muted">
          {usage.people.map((person) => (
            <li key={person.userId}>
              {person.label}: {count(person.calls)} {person.calls === 1 ? "call" : "calls"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function shortDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** The Claude connector link for a key. Claude reads the key from the link. */
export function connectorLink(key: string): string {
  return `${SITE_URL}/api/v1/mcp?api_key=${key}`;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3">
      <p className="text-[13px] font-medium text-ink">{label}</p>
      <div className="mt-1 flex items-stretch gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md bg-paper px-3 py-2 text-[12px] text-ink">{value}</code>
        <button
          type="button"
          className={BUTTON}
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/**
 * API and Claude connector access for the person who pays for a plan that includes it.
 * A new key shows once; after that only its first characters are kept.
 */
export function ApiAccessCard({ access }: { access: ApiAccess }) {
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (access.kind === "upgrade") {
    return (
      <AccountCard id="api" title="API and Claude connector" compact>
        <p className="text-[14px] text-ink">
          The {PRODUCT_NAME} API and the Claude connector come with the {API_PLANS_LABEL}.
        </p>
        <a
          href={`mailto:${CONTACT_EMAIL}?subject=Add%20the%20API%20to%20my%20plan`}
          className="mt-3 inline-block text-[14px] font-medium text-brick hover:underline"
        >
          Ask to change plans
        </a>
      </AccountCard>
    );
  }

  const key = access.key;

  function create() {
    if (key && !window.confirm("Replace your key? The old key stops working right away.")) return;
    setError(null);
    startTransition(async () => {
      const result = await createAccountApiKey();
      if ("key" in result) setNewKey(result.key);
      else setError(result.error);
    });
  }

  function revoke() {
    if (!window.confirm("Turn off your key? Anything using it stops working.")) return;
    setError(null);
    startTransition(async () => {
      const result = await revokeAccountApiKey();
      if ("error" in result) setError(result.error);
      else setNewKey(null);
    });
  }

  return (
    <AccountCard
      id="api"
      title="API and Claude connector"
      compact
      note={`Your plan includes the ${PRODUCT_NAME} API. Everyone on it shares ${API_MONTHLY_CALLS_LABEL} calls a month.`}
    >
      {newKey ? (
        <div>
          <p className="text-[14px] font-medium text-ink">Copy your key now. It won&rsquo;t be shown again.</p>
          <CopyField label="API key" value={newKey} />
          <CopyField label="Claude connector link" value={connectorLink(newKey)} />
        </div>
      ) : key ? (
        <p className="text-[14px] text-ink">
          Key <code className="text-[13px]">{key.prefix}…</code> made {shortDate(key.createdAt)}
          {key.lastUsedAt ? `, last used ${shortDate(key.lastUsedAt)}` : ", not used yet"}.
        </p>
      ) : (
        <p className="text-[14px] text-ink">Make a key to use the data in Claude, Excel or your own code.</p>
      )}
      {access.usage && <UsageLine usage={access.usage} />}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={BUTTON} disabled={pending} onClick={create}>
          {pending ? "Working..." : key || newKey ? "Replace key" : "Make a key"}
        </button>
        {(key || newKey) && (
          <button type="button" className={BUTTON} disabled={pending} onClick={revoke}>
            Turn off key
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-brick">
          {error}
        </p>
      )}

      <details open={newKey ? true : undefined} className="mt-4 text-[13px] text-ink-muted">
        <summary className="cursor-pointer font-medium text-ink">How to connect</summary>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          <li>
            <span className="text-ink">Claude:</span> in Settings, open Connectors, add a custom connector and paste
            your connector link.
          </li>
          <li>
            <span className="text-ink">Excel:</span> choose Data, then From Web, and paste an API address that ends
            in <code>format=csv&amp;api_key=</code> plus your key.
          </li>
          <li>
            <span className="text-ink">Your own code:</span> send the key in an{" "}
            <code>Authorization: Bearer</code> header.
          </li>
        </ol>
        <p className="mt-2">
          Keep the key private. Anyone who has it can use your monthly calls.{" "}
          <a href="/api-docs" className="text-brick hover:underline">
            See every endpoint
          </a>
        </p>
      </details>
    </AccountCard>
  );
}
