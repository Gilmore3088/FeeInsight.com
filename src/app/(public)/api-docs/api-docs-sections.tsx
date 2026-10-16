"use client";

import { useState } from "react";
import { TrackLink } from "@/components/track-link";
import { DEMO_REQUEST_NAV } from "@/components/nav-items";
import {
  ACCESS_LABEL,
  API_KEY_REQUEST_HREF,
  COPY,
  fullPath,
  paramNote,
  responseShape,
  type ApiAccess,
  type ApiEndpoint,
  type KeyTier,
} from "./api-docs-view";

const DISPLAY = { fontFamily: "var(--fi-font-sans)" };
const H2 = "text-xl font-bold tracking-tight text-ink sm:text-2xl";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {});
      }}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-3 text-[12px] font-medium text-warm-ink-300 hover:text-warm-ink-50"
    >
      <span aria-live="polite">{copied ? COPY.copied : COPY.copy}</span>
    </button>
  );
}

/** A dark code panel: scrolls sideways inside itself, never the page. */
export function CodeBlock({ label, code, note }: { label: string; code: string; note?: string }) {
  return (
    <figure className="fi-on-navy min-w-0 overflow-hidden rounded-xl bg-warm-ink-900 ring-1 ring-ink/10">
      <figcaption className="flex items-center justify-between gap-3 border-b border-warm-ink-700 pl-4">
        <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wider text-warm-ink-300">
          {label}
          {note ? <span className="ml-2 normal-case tracking-normal text-warm-ink-500">{note}</span> : null}
        </span>
        <CopyButton text={code} />
      </figcaption>
      <pre tabIndex={0} className="overflow-x-auto px-4 py-4 text-[12.5px] leading-relaxed text-warm-ink-50">
        <code>{code}</code>
      </pre>
    </figure>
  );
}

export function ApiHero({
  coverage,
  freshnessLabel,
}: {
  coverage: readonly { label: string; value: string }[];
  freshnessLabel: string;
}) {
  return (
    <section className="fi-on-navy bg-warm-ink-900 text-warm-ink-50">
      <div className="mx-auto max-w-5xl px-4 pb-10 pt-12 sm:px-6 sm:pt-16">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-warm-ink-300">{COPY.eyebrow}</p>
        <h1 className="mt-2 text-[2rem] font-extrabold leading-[1.1] tracking-[-0.02em] sm:text-[2.75rem]" style={DISPLAY}>
          {COPY.title}
        </h1>
        <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-warm-ink-300">{COPY.lede}</p>
        <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-warm-ink-700 sm:grid-cols-4">
          {coverage.map((item) => (
            <div key={item.label} className="flex flex-col-reverse bg-warm-ink-800 px-4 py-4">
              <dt className="mt-1 text-[12px] leading-snug text-warm-ink-300">{item.label}</dt>
              <dd className="text-2xl font-bold tabular-nums text-warm-ink-50" style={DISPLAY}>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[12px] text-warm-ink-500">{freshnessLabel}</p>
      </div>
    </section>
  );
}

export function Quickstart({
  request,
  response,
  responseLabel,
  responseNote,
}: {
  request: string;
  response: string;
  responseLabel: string;
  responseNote?: string;
}) {
  return (
    <section aria-labelledby="quickstart-heading">
      <h2 id="quickstart-heading" className={H2} style={DISPLAY}>
        {COPY.quickstartHeading}
      </h2>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <CodeBlock label={COPY.requestLabel} code={request} />
        <CodeBlock label={responseLabel} note={responseNote} code={response} />
      </div>
    </section>
  );
}

const ACCESS_STYLE: Record<ApiAccess, string> = {
  key: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  pro: "bg-brick/5 text-brick ring-brick/30",
  public: "bg-paper text-ink-muted ring-border",
};

export function AccessBadge({ access }: { access: ApiAccess }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${ACCESS_STYLE[access]}`}>
      {ACCESS_LABEL[access]}
    </span>
  );
}

function EndpointRow({ endpoint }: { endpoint: ApiEndpoint }) {
  const path = fullPath(endpoint);
  return (
    <li id={endpoint.id} className="scroll-mt-20">
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-start gap-3 px-4 py-3 hover:bg-paper [&::-webkit-details-marker]:hidden">
          <span
            className={`mt-0.5 w-11 shrink-0 rounded text-center text-[11px] font-bold leading-5 ${
              endpoint.method === "GET" ? "bg-ink text-paper" : "bg-brick text-white"
            }`}
          >
            {endpoint.method}
          </span>
          <span className="min-w-0 flex-1">
            <code className="block break-all text-[13.5px] font-medium text-ink">{path}</code>
            <span className="mt-0.5 block text-[13.5px] text-ink-muted">{endpoint.summary}</span>
          </span>
          <AccessBadge access={endpoint.access} />
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-ink-muted transition-transform group-open:rotate-90">
            &rsaquo;
          </span>
        </summary>
        <div className="space-y-4 px-4 pb-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{COPY.paramsLabel}</p>
            {endpoint.params.length === 0 ? (
              <p className="mt-1 text-[13px] text-ink-muted">{COPY.noParams}</p>
            ) : (
              <dl className="mt-2 divide-y divide-border/70 rounded-lg border border-border/70 bg-white">
                {endpoint.params.map((param) => (
                  <div key={param.name} className="grid gap-x-4 gap-y-0.5 px-3 py-2 sm:grid-cols-[11rem_1fr]">
                    <dt className="min-w-0">
                      <code className="text-[12.5px] font-medium text-ink">{param.name}</code>
                      {param.required ? <span className="ml-1.5 text-[11px] font-semibold text-brick">{COPY.required}</span> : null}
                      <span className="block break-words text-[11.5px] text-ink-muted">{param.type}</span>
                    </dt>
                    <dd className="text-[13px] text-ink-soft">{paramNote(param)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          {endpoint.fields.length > 0 ? (
            <CodeBlock label={COPY.responseLabel} code={responseShape(endpoint.fields)} />
          ) : null}
          {endpoint.access === "public" ? (
            <a href={path} className="inline-flex min-h-11 items-center text-[14px] font-medium text-ink underline underline-offset-2">
              {COPY.openSpec}
            </a>
          ) : null}
        </div>
      </details>
    </li>
  );
}

export function EndpointList({ endpoints }: { endpoints: readonly ApiEndpoint[] }) {
  return (
    <section aria-labelledby="endpoints-heading">
      <h2 id="endpoints-heading" className={H2} style={DISPLAY}>
        {COPY.endpointsHeading}
      </h2>
      <ul className="mt-5 divide-y divide-border overflow-hidden rounded-xl border border-border bg-white">
        {endpoints.map((endpoint) => (
          <EndpointRow key={endpoint.id} endpoint={endpoint} />
        ))}
      </ul>
    </section>
  );
}

export function KeysAndLimits({
  tiers,
  errors,
  headers,
}: {
  tiers: readonly KeyTier[];
  errors: readonly { status: number; code: string; when: string }[];
  headers: readonly string[];
}) {
  const [allowanceCol, categoriesCol, endpointsCol] = COPY.tierColumns;
  return (
    <section aria-labelledby="keys-heading">
      <h2 id="keys-heading" className={H2} style={DISPLAY}>
        {COPY.accessHeading}
      </h2>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-soft">{COPY.authLine}</p>
      <ul className="mt-5 grid gap-3 sm:grid-cols-3">
        {tiers.map((tier) => (
          <li key={tier.name} className="rounded-xl border border-border bg-white px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{tier.name}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-ink" style={DISPLAY}>
              {tier.allowance}
            </p>
            <p className="text-[12px] text-ink-muted">{allowanceCol}</p>
            <dl className="mt-3 space-y-1 text-[13px]">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">{categoriesCol}</dt>
                <dd className="text-right font-medium text-ink">{tier.categories}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">{endpointsCol}</dt>
                <dd className="text-right font-medium text-ink">{tier.endpoints}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-ink-soft">
        {COPY.limitLine}{" "}
        {headers.map((header, i) => (
          <span key={header}>
            <code className="text-[12.5px] text-ink">{header}</code>
            {i < headers.length - 1 ? " " : ""}
          </span>
        ))}
      </p>
      <h3 className="mt-8 text-[15px] font-bold text-ink" style={DISPLAY}>
        {COPY.errorsHeading}
      </h3>
      <ul className="mt-3 divide-y divide-border/70 rounded-xl border border-border bg-white">
        {errors.map((error) => (
          <li key={error.code} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 text-[13px]">
            <span className="w-9 shrink-0 font-semibold tabular-nums text-ink">{error.status}</span>
            <code className="text-[12.5px] text-ink">{error.code}</code>
            <span className="basis-full text-ink-muted sm:basis-auto">{error.when}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-ink px-5 text-[15px] font-semibold text-paper hover:bg-ink/90";
const SECONDARY = "inline-flex min-h-11 items-center text-[15px] font-medium text-ink underline underline-offset-2";

export function GetKeyCta() {
  return (
    <section aria-labelledby="get-key-heading" className="rounded-2xl border border-border bg-white px-5 py-6 sm:px-8">
      <h2 id="get-key-heading" className={H2} style={DISPLAY}>
        {COPY.ctaHeading}
      </h2>
      <p className="mt-2 text-[15px] text-ink-soft">{COPY.ctaLine}</p>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <TrackLink event="contact_sales" eventProps={{ placement: "api_docs_key" }} href={API_KEY_REQUEST_HREF} className={PRIMARY}>
          {COPY.ctaButton}
        </TrackLink>
        <TrackLink
          event="contact_sales"
          eventProps={{ placement: "api_docs_demo" }}
          href={DEMO_REQUEST_NAV.href}
          className={SECONDARY}
        >
          {DEMO_REQUEST_NAV.label}
        </TrackLink>
      </div>
    </section>
  );
}
