import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Next 16.4.2 requires the newer Hooks analyzer. It reports these diagnostics in
  // unchanged components where 7.0.1 reported none. Keep them visible during gradual
  // compiler adoption without coupling the security patch to a workspace rewrite.
  // Only these existing files/rules are warnings; core Hook checks and every other
  // compiler diagnostic retain their defaults. See the dated framework finding.
  {
    files: [
      "src/app/(public)/fees/city/\\[state\\]/\\[city\\]/market-table.tsx",
      "src/app/admin/atlas-live-status.tsx",
      "src/app/admin/coverage/components/magellan-console.tsx",
      "src/components/hamilton/InstitutionPicker.tsx",
      "src/components/hamilton/analyze/PeerAwareStructuredAsk.tsx",
      "src/components/hamilton/monitor/WatchlistPanel.tsx",
      "src/components/hamilton/reports/ReportWorkspace.tsx",
      "src/components/public/search-modal.tsx",
    ],
    rules: { "react-hooks/set-state-in-effect": "warn" },
  },
  {
    files: ["src/components/hamilton/analyze/AnalyzeWorkspace.tsx"],
    rules: {
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  {
    files: ["src/components/hamilton/analyze/StructuredAsk.tsx"],
    rules: { "react-hooks/refs": "warn" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".vercel/**",
    ".worktrees/**",
    "out/**",
    "build/**",
    "coverage/**",
    "test-results/**",
    "next-env.d.ts",
    // Design system hand-off examples and reference files, not app code.
    "Branding/**",
  ]),
]);

export default eslintConfig;
