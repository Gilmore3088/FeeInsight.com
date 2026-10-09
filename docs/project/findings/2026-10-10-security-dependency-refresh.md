# Resolve the framework and high-severity dependency findings

R01 / issue #983. Pin Next.js to 16.4.0 and React/react-dom to 19.3.0. Refresh the
vulnerable XML, source-map, browser-mapping, and HTML sanitizer dependency paths
within their compatible constraints. The implementation commit includes the
resolved lockfile. No application feature, cache mode, provider, or SQL changed.

Keep the existing eslint-config-next 16.1.6 and its lint policy in this security-only
change. Trying the 16.4.0 lint configuration introduced 27 React-compiler/effect
lint errors across existing UI code. That proposed policy upgrade is recorded in
`2026-10-10-react-lint-upgrade-findings.md` rather than silently disabling rules or
mixing unrelated UI changes into a dependency security fix. Existing lint checks
remain required. This is not a claim that those UI findings have been fixed.

The isolated candidate's production dependency scan reported zero critical and
zero high entries, down from one critical and five high on the branch base. Six
entries remained: five low entries in the AI SDK dependency path and one moderate
entry for the direct Anthropic SDK's filesystem memory helper. Repository source
contains no MemoryTool, BetaMemoryTool, memory_20250818, or beta.tools.memory
references. This is a scoped exposure observation, not proof of zero risk and not
a claim that the remaining advisories are patched. Review the AI SDK upgrade
separately instead of forcing a pre-1.0 SDK version jump into this patch.

The final branch lockfile must pass a fresh npm audit at the high threshold,
TypeScript, repository guards, full tests, existing lint policy, and production
build before the implementation commit. Advisory feeds can change independently
of code. No live provider call or production credential is used.

Reproduce with npm ci, npm audit --omit=dev --audit-level=high,
npm run guard:legacy, npx tsc --noEmit, npx vitest run, and npm run build.
Vendor release: https://nextjs.org/blog/next-16-4
