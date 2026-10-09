# Resolve the framework and high-severity dependency findings

R01 / issue #983. Pin Next.js and eslint-config-next to 16.4.0, React and react-dom
to 19.3.0, and refresh the vulnerable XML, source-map, browser-mapping, and HTML
sanitizer dependency paths within their compatible constraints. The lockfile is
part of the implementation commit. No application feature, cache mode, provider,
or SQL changed.

The isolated candidate's production dependency scan reported zero critical and
zero high entries, down from one critical and five high on the branch base. Six
entries remained: five low entries in the AI SDK dependency path and one moderate
entry for the direct Anthropic SDK's filesystem memory helper. Repository source
contains no MemoryTool, BetaMemoryTool, memory_20250818, or beta.tools.memory
references. This is a scoped exposure observation, not proof of zero security risk
and not a claim that the remaining advisories are patched. Review the AI SDK
upgrade separately instead of silently forcing a pre-1.0 SDK version jump into
the framework change.

The final branch lockfile must pass a fresh npm audit at the high threshold,
TypeScript, repository guards, full tests, lint, and production build before the
implementation commit. The advisory feed can change independently of code.
A full audit can remain nonzero because explicitly documented lower-severity
entries are retained. No live provider call or production credential is used.

Reproduce with npm ci, npm audit --omit=dev --audit-level=high,
npm run guard:legacy, npx tsc --noEmit, npx vitest run, and npm run build.
Vendor release: https://nextjs.org/blog/next-16-4
