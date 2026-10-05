#!/usr/bin/env bash
# Phase 62a CI guards.
# Usage: scripts/ci-guards.sh <subcommand>
# Subcommands:
#   sqlite-kill   Fail if any sqlite3|better-sqlite3|DB_PATH reference remains in runtime src.
#   modal-kill    Fail if runtime TypeScript/JavaScript/Edge code can call Modal endpoints.
#   legacy-kill   Fail if runtime TypeScript/JavaScript can call retired execution surfaces.
#   fee-read-model-kill
#                 Fail if product/runtime fee reads bypass published_fee_catalog.
#   script-kill   Fail if retired one-off data/process scripts are reintroduced.
#   config-kill   Fail if active CI/deploy/env-example config references retired surfaces.
#   edge-function-kill
#                 Fail if Supabase Edge Functions are tracked as a parallel runtime.
#   artifact-kill Fail if local agent worktrees or stale tool output are tracked.
#   provider-kill Fail if provider construction is bypassing src/lib/ai-provider.ts.
#   legacy-name-kill
#                 Fail if active code/docs reintroduce retired module names.
#   source-read-model-kill
#                 Fail if migrated read boundaries query crawl_* tables directly.
#   agent-source-contract-kill
#                 Fail if active document agents use crawler-era source column names.
#   fee-tier-contract-kill
#                 Fail if fee-tier agents use physical tier tables directly.
#   catalog-contract-kill
#                 Fail if published fee catalog consumers use crawler-era aliases.
#   legacy-data-contract-kill
#                 Fail if active app code uses crawler-era institution keys or physical data tables.
#   sql-placeholder-kill
#                 Fail if SQL placeholders are computed as $${params.length - N}; capture each one when it is pushed.
#   heading-wrap-kill
#                 Fail if the site-wide or report-template rule that stops one-word heading lines is removed.
#   brand-kill    Fail if src copy names the site as the product or references bankfeeindex.com (Fee Insight is the site; Bank Fee Index is the product).
#   prompt-kill   Fail if active .claude prompts point agents at retired tooling.
#   active-doc-kill
#                 Fail if current docs/plans contain stale runtime guidance.
#   migration-history-kill
#                 Fail if post-agentic-decommission migrations reintroduce retired runtime concepts.

set -euo pipefail

SUBCOMMAND="${1:-}"

sqlite_kill() {
  local include_dirs=("src")
  local exclude_paths=(
    ":(exclude)src/app/api/_archive"
    ":(exclude)src/**/node_modules/**"
  )

  # Use git grep if in a repo (faster + respects .gitignore), else plain grep.
  local hits=""
  if git rev-parse --git-dir >/dev/null 2>&1; then
    hits=$(git grep -nE 'better-sqlite3|sqlite3|DB_PATH' -- \
      "${include_dirs[@]}" "${exclude_paths[@]}" \
      | grep -v '^Binary file' || true)
  else
    hits=$(grep -rnE 'better-sqlite3|sqlite3|DB_PATH' \
      --include='*.py' --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
      --exclude-dir=__pycache__ --exclude-dir=node_modules \
      --exclude='SQLITE_AUDIT.md' \
      --exclude='test_sc4_no_sqlite.py' \
      "${include_dirs[@]}" 2>/dev/null || true)
  fi

  if [[ -n "$hits" ]]; then
    echo "sqlite-kill: runtime SQLite references remain:" >&2
    echo "$hits" >&2
    exit 1
  fi

  echo "sqlite-kill: OK (zero matches in runtime src/)"
  exit 0
}

modal_kill() {
  local include_dirs=("src" "supabase/functions" ".github")
  local exclude_paths=(
    ":(exclude)src/**/node_modules/**"
  )
  local pattern='modal\.run|process\.env\.(OPS_RUN_URL|OPS_CANCEL_URL|MODAL_[A-Z0-9_]*|DARWIN_SIDECAR_URL|MAGELLAN_SIDECAR_URL|EXTRACT_SINGLE_URL)|MODAL_REPORT_URL|MODAL_DISCOVER_URL'
  local hits=""

  if git rev-parse --git-dir >/dev/null 2>&1; then
    hits=$(git grep -nE "$pattern" -- \
      "${include_dirs[@]}" "${exclude_paths[@]}" \
      | grep -v '^Binary file' || true)
  else
    hits=$(grep -rnE "$pattern" \
      --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
      --exclude-dir=node_modules \
      "${include_dirs[@]}" 2>/dev/null || true)
  fi

  if [[ -n "$hits" ]]; then
    echo "modal-kill: runtime Modal endpoint/env references remain:" >&2
    echo "$hits" >&2
    exit 1
  fi

  echo "modal-kill: OK (no runtime Modal endpoint/env references in src/, supabase/functions/, or .github/)"
  exit 0
}

legacy_kill() {
  local include_dirs=("src" "supabase/functions" ".github")
  local exclude_paths=(
    ":(exclude)src/**/node_modules/**"
    ":(exclude)src/**/*.test.ts"
    ":(exclude)src/**/*.test.tsx"
    ":(exclude)src/lib/execution-backend.ts"
    # Agent guidance docs name retired surfaces only to forbid them; they are not runtime code.
    ":(exclude)src/**/AGENTS.md"
  )
  local pattern='spawnJob\(|from ['\''"]@/lib/job-runner['\''"]|from ['\''"][^'\'']*/job-runner['\''"]|\bops_jobs\b|\bops_job_id\b|\bmodal_call_id\b|modalCallId|python -m fee_crawler|process\.env\.(OPS_RUN_URL|OPS_CANCEL_URL|MODAL_[A-Z0-9_]*|DARWIN_SIDECAR_URL|MAGELLAN_SIDECAR_URL|EXTRACT_SINGLE_URL)|modal\.run'
  local hits=""

  if git rev-parse --git-dir >/dev/null 2>&1; then
    hits=$(git grep -nE "$pattern" -- \
      "${include_dirs[@]}" "${exclude_paths[@]}" \
      | grep -v '^Binary file' || true)
  else
    hits=$(grep -rnE "$pattern" \
      --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
      --exclude-dir=node_modules \
      "${include_dirs[@]}" 2>/dev/null || true)
  fi

  if [[ -n "$hits" ]]; then
    echo "legacy-kill: retired execution references remain in runtime src:" >&2
    echo "$hits" >&2
    exit 1
  fi

  echo "legacy-kill: OK (no retired execution references in runtime src/, supabase/functions/, or .github/)"
  exit 0
}

fee_read_model_kill() {
  local include_dirs=("src" "supabase/functions")
  local exclude_paths=(
    ":(exclude)src/**/node_modules/**"
    ":(exclude)src/**/*.test.ts"
    ":(exclude)src/**/*.test.tsx"
  )
  local hits=""

  if git rev-parse --git-dir >/dev/null 2>&1; then
    hits=$(git grep --untracked -nE '\b(extracted_fees|published_fee_observations)\b' -- \
      "${include_dirs[@]}" "${exclude_paths[@]}" \
      | grep -v '^Binary file' || true)
  else
    hits=$(grep -rnE '\b(extracted_fees|published_fee_observations)\b' \
      --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
      --exclude-dir=node_modules \
      "${include_dirs[@]}" 2>/dev/null || true)
  fi

  if [[ -n "$hits" ]]; then
    echo "fee-read-model-kill: runtime fee reads must use published_fee_catalog:" >&2
    echo "$hits" >&2
    exit 1
  fi

  echo "fee-read-model-kill: OK (runtime reads use published_fee_catalog, not retired fee read models)"
  exit 0
}

script_kill() {
  local include_dirs=("scripts")
  local exclude_paths=(
    ":(exclude)scripts/ci-guards.sh"
    ":(exclude)scripts/check-admin-production-routes.mjs"
  )
  local pattern='fee_crawler|python3? -m fee_crawler|\bops_jobs\b|\bops_job_id\b|\bmodal_call_id\b|modalCallId|\bextracted_fees\b|process\.env\.(OPS_RUN_URL|OPS_CANCEL_URL|MODAL_[A-Z0-9_]*|DARWIN_SIDECAR_URL|MAGELLAN_SIDECAR_URL|EXTRACT_SINGLE_URL)|MODAL_REPORT_URL|modal\.run'
  local hits=""

  if [[ ! -d scripts ]]; then
    echo "script-kill: OK (scripts/ is absent)"
    exit 0
  fi

  if git rev-parse --git-dir >/dev/null 2>&1; then
    hits=$(git grep -nE "$pattern" -- \
      "${include_dirs[@]}" "${exclude_paths[@]}" \
      | grep -v '^Binary file' || true)
  else
    hits=$(grep -rnE "$pattern" \
      --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.py' --include='*.sh' \
      --exclude='ci-guards.sh' --exclude='check-admin-production-routes.mjs' \
      "${include_dirs[@]}" 2>/dev/null || true)
  fi

  if [[ -n "$hits" ]]; then
    echo "script-kill: retired data/process scripts remain:" >&2
    echo "$hits" >&2
    exit 1
  fi

  echo "script-kill: OK (no retired data/process scripts)"
  exit 0
}

config_kill() {
  local include_paths=(
    ".env.example"
    ".github"
    "next.config.ts"
    "package.json"
    "supabase/functions"
    "vercel.json"
  )
  local exclude_paths=(
    ":(exclude).github/**/node_modules/**"
  )
  local pattern='fee_crawler|python3? -m fee_crawler|\bops_jobs\b|\bops_job_id\b|\bmodal_call_id\b|modalCallId|\bextracted_fees\b|process\.env\.(OPS_RUN_URL|OPS_CANCEL_URL|MODAL_[A-Z0-9_]*|DARWIN_SIDECAR_URL|MAGELLAN_SIDECAR_URL|EXTRACT_SINGLE_URL)|MODAL_REPORT_URL|MODAL_DISCOVER_URL|DARWIN_SIDECAR_URL|MAGELLAN_SIDECAR_URL|EXTRACT_SINGLE_URL|modal\.run'
  local hits=""

  if git rev-parse --git-dir >/dev/null 2>&1; then
    hits=$(git grep -nE "$pattern" -- \
      "${include_paths[@]}" "${exclude_paths[@]}" \
      | grep -v '^Binary file' || true)
  else
    hits=$(grep -rnE "$pattern" \
      --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.json' --include='*.yml' --include='*.yaml' --include='.env.example' \
      --exclude-dir=node_modules \
      "${include_paths[@]}" 2>/dev/null || true)
  fi

  if [[ -n "$hits" ]]; then
    echo "config-kill: active config references retired execution/data surfaces:" >&2
    echo "$hits" >&2
    exit 1
  fi

  echo "config-kill: OK (no retired execution/data surfaces in active config)"
  exit 0
}

artifact_kill() {
  local hits=""

  if git rev-parse --git-dir >/dev/null 2>&1; then
    hits=$(git ls-files -- \
      'fee_crawler/**' \
      'scripts/migrations/**' \
      '.claude/worktrees/**' \
      '.superpowers/**' \
      '.pytest_cache/**' \
      '.ruff_cache/**' \
      '__pycache__/**' \
      '*.pyc' \
      '*.pyo' \
      '*.db' \
      '*.sqlite' \
      '*.sqlite3' \
      | while IFS= read -r path; do
          [[ -e "$path" ]] && printf '%s\n' "$path"
        done \
      | sed '/^$/d' || true)
  fi

  if [[ -n "$hits" ]]; then
    echo "artifact-kill: tracked local/legacy artifacts remain:" >&2
    echo "$hits" >&2
    exit 1
  fi

  echo "artifact-kill: OK (no tracked local agent worktrees, stale tool output, or crawler artifacts)"
  exit 0
}

edge_function_kill() {
  local hits=""

  if git rev-parse --git-dir >/dev/null 2>&1; then
    hits=$(git ls-files -- 'supabase/functions/**' \
      | while IFS= read -r path; do
          [[ -e "$path" ]] && printf '%s\n' "$path"
        done \
      | sed '/^$/d' || true)
  elif [[ -d supabase/functions ]]; then
    hits=$(find supabase/functions -type f | sort || true)
  fi

  if [[ -n "$hits" ]]; then
    echo "edge-function-kill: Supabase Edge Functions remain as a parallel runtime:" >&2
    echo "$hits" >&2
    exit 1
  fi

  echo "edge-function-kill: OK (no tracked Supabase Edge Function runtime)"
  exit 0
}

provider_kill() {
  local include_dirs=("src")
  local exclude_paths=(
    ":(exclude)src/lib/ai-provider.ts"
    ":(exclude)src/**/*.test.ts"
    ":(exclude)src/**/*.test.tsx"
    ":(exclude)src/**/node_modules/**"
  )
  local pattern='from ['\''"]@anthropic-ai/sdk['\''"]|from ['\''"]@ai-sdk/anthropic['\''"]|new Anthropic\('
  local hits=""

  if git rev-parse --git-dir >/dev/null 2>&1; then
    hits=$(git grep -nE "$pattern" -- \
      "${include_dirs[@]}" "${exclude_paths[@]}" \
      | grep -v '^Binary file' || true)
  else
    hits=$(grep -rnE "$pattern" \
      --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
      --exclude='ai-provider.ts' --exclude-dir=node_modules \
      "${include_dirs[@]}" 2>/dev/null || true)
  fi

  if [[ -n "$hits" ]]; then
    echo "provider-kill: direct provider construction/imports remain outside src/lib/ai-provider.ts:" >&2
    echo "$hits" >&2
    exit 1
  fi

  echo "provider-kill: OK (provider construction is centralized in src/lib/ai-provider.ts)"
  exit 0
}

prompt_kill() {
  local include_paths=(
    ".claude/agents"
    ".claude/commands"
    ".claude/skills"
  )
  local pattern='fee_crawler|python3? -m fee_crawler|\bextracted_fees\b|crawler-db|data/crawler\.db|SQLite database|\bops_jobs\b|\bops_job_id\b|\bmodal_call_id\b|modalCallId|modal\.run|\bcrawl_targets\b|\bcrawl_results\b|\bcrawl_runs\b|\bcrawl_target_id\b|\bcrawl_result_id\b|\bagent_document_texts\b|\bfees_raw\b|\bfees_verified\b|\bfees_published\b|\bpublished_fee_observations\b'
  local hits=""

  if git rev-parse --git-dir >/dev/null 2>&1; then
    hits=$(git grep --untracked -nE "$pattern" -- \
      "${include_paths[@]}" \
      | grep -v '^Binary file' || true)
  else
    hits=$(grep -rnE "$pattern" \
      --include='*.md' --include='SKILL.md' \
      "${include_paths[@]}" 2>/dev/null || true)
  fi

  if [[ -n "$hits" ]]; then
    echo "prompt-kill: active .claude prompts still reference retired execution/data tooling:" >&2
    echo "$hits" >&2
    exit 1
  fi

  echo "prompt-kill: OK (active .claude prompts do not point at retired tooling)"
  exit 0
}

active_doc_kill() {
  local include_paths=(
    "docs"
    ".planning"
    "README.md"
    ".impeccable.md"
  )
  local exclude_paths=(
    ":(exclude)docs/archive/**"
  )
  local pattern='data/crawler\.db|SQLite database|Fly\.io|Litestream|COMING_SOON|crawler-db|python3? -m fee_crawler|fee_crawler/'
  local hits=""

  if git rev-parse --git-dir >/dev/null 2>&1; then
    hits=$(git grep --untracked -nE "$pattern" -- \
      "${include_paths[@]}" "${exclude_paths[@]}" \
      | grep -v '^Binary file' || true)
  else
    hits=$(grep -rnE "$pattern" \
      --include='*.md' --include='*.mdx' \
      --exclude-dir=archive \
      "${include_paths[@]}" 2>/dev/null || true)
  fi

  if [[ -n "$hits" ]]; then
    echo "active-doc-kill: active docs/plans still contain stale runtime guidance:" >&2
    echo "$hits" >&2
    exit 1
  fi

  echo "active-doc-kill: OK (current docs/plans do not contain stale runtime guidance)"
  exit 0
}

migration_history_kill() {
  local cutoff="20260813000200_provider_usage_agent_runs.sql"
  # Historical migrations were archived on 2026-08-16 (docs/plans/supabase-migration-drift-resolution-2026-08-16.md);
  # the cutoff file now lives in the archive but the ledger contract it enforces still applies.
  local cutoff_path="supabase/migrations/$cutoff"
  if [[ ! -f "$cutoff_path" ]]; then
    cutoff_path="docs/archive/supabase-migrations-2026-08-16/$cutoff"
  fi
  local pattern='fee_crawler|python3? -m fee_crawler|\bops_jobs\b|\bops_job_id\b|\bmodal_call_id\b|modalCallId|Modal workers|modal\.run|DARWIN_SIDECAR_URL|MAGELLAN_SIDECAR_URL|EXTRACT_SINGLE_URL'
  local hits=""

  if [[ -d supabase/migrations ]]; then
    while IFS= read -r file; do
      local base
      base="$(basename "$file")"
      if [[ "$base" > "$cutoff" ]]; then
        local file_hits
        file_hits=$(grep -nE "$pattern" "$file" 2>/dev/null | sed "s#^#$file:#" || true)
        if [[ -n "$file_hits" ]]; then
          hits="${hits}${file_hits}"$'\n'
        fi
      fi
    done < <(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort)
  fi

  if [[ -n "$hits" ]]; then
    echo "migration-history-kill: post-agentic-decommission migrations reference retired runtime concepts:" >&2
    echo "$hits" >&2
    exit 1
  fi

  if ! grep -q 'DROP TABLE IF EXISTS ops_jobs' "$cutoff_path"; then
    echo "migration-history-kill: $cutoff must drop retired ops_jobs" >&2
    exit 1
  fi

  if ! grep -q 'DROP COLUMN IF EXISTS modal_call_id' "$cutoff_path"; then
    echo "migration-history-kill: $cutoff must drop retired modal_call_id columns" >&2
    exit 1
  fi

  echo "migration-history-kill: OK (post-agentic migration history stays clean)"
  exit 0
}

legacy_name_kill() {
  local include_paths=("src" "CLAUDE.md" ".planning" "docs/plans" "README.md")
  local exclude_paths=(
    ":(exclude)src/**/node_modules/**"
  )
  local hits=""

  if git rev-parse --git-dir >/dev/null 2>&1; then
    hits=$(git grep --untracked -nF 'crawler-db' -- \
      "${include_paths[@]}" "${exclude_paths[@]}" \
      | grep -v '^Binary file' || true)
  else
    hits=$(grep -rnF 'crawler-db' \
      --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.md' \
      --exclude-dir=node_modules --exclude-dir=archive \
      "${include_paths[@]}" 2>/dev/null || true)
  fi

  if [[ -n "$hits" ]]; then
    echo "legacy-name-kill: retired data module name remains in active code/docs:" >&2
    echo "$hits" >&2
    exit 1
  fi

  echo "legacy-name-kill: OK (no active crawler-db module references)"
  exit 0
}

source_read_model_kill() {
  local pattern='(FROM|JOIN|UPDATE|INSERT INTO|DELETE FROM)[[:space:]]+(public\.)?(crawl_targets|crawl_results|crawl_runs)\b'
  local hits=""

  if git rev-parse --git-dir >/dev/null 2>&1; then
    hits=$(git grep --untracked -nE "$pattern" -- src | grep -v '^Binary file' || true)
  else
    hits=$(grep -R -nE "$pattern" src 2>/dev/null || true)
  fi

  if [[ -n "$hits" ]]; then
    echo "source-read-model-kill: app code still queries crawl_* source tables directly:" >&2
    echo "$hits" >&2
    exit 1
  fi

  echo "source-read-model-kill: OK (app code uses agentic source contracts)"
  exit 0
}

agent_source_contract_kill() {
  local include_paths=(
    "src/lib/agents/magellan/discovery.ts"
    "src/lib/agents/magellan/fetch.ts"
    "src/lib/agents/rosetta/read.ts"
    "src/lib/agents/knox/extract.ts"
    "src/lib/agents/run-store.ts"
  )
  local pattern='crawl_result_id|crawl_target_id|agent_document_texts'
  local hits=""

  if git rev-parse --git-dir >/dev/null 2>&1; then
    hits=$(git grep --untracked -nE "$pattern" -- "${include_paths[@]}" | grep -v '^Binary file' || true)
  else
    hits=$(grep -nE "$pattern" "${include_paths[@]}" 2>/dev/null || true)
  fi

  if [[ -n "$hits" ]]; then
    echo "agent-source-contract-kill: active document agents still use crawler-era source names:" >&2
    echo "$hits" >&2
    exit 1
  fi

  echo "agent-source-contract-kill: OK (document agents use semantic source names)"
  exit 0
}

fee_tier_contract_kill() {
  local include_paths=(
    "src/lib/agents/knox/extract.ts"
    "src/lib/agents/darwin/verify.ts"
    "src/lib/agents/hamilton/publish.ts"
    "src/lib/agents/run-store.ts"
  )
  local pattern='fees_raw|fees_verified|fees_published|crawl_event_id'
  local hits=""

  if git rev-parse --git-dir >/dev/null 2>&1; then
    hits=$(git grep --untracked -nE "$pattern" -- "${include_paths[@]}" | grep -v '^Binary file' || true)
  else
    hits=$(grep -nE "$pattern" "${include_paths[@]}" 2>/dev/null || true)
  fi

  if [[ -n "$hits" ]]; then
    echo "fee-tier-contract-kill: fee-tier agents still use physical tier tables or crawler-era lineage names:" >&2
    echo "$hits" >&2
    exit 1
  fi

  echo "fee-tier-contract-kill: OK (fee-tier agents use semantic tier contracts)"
  exit 0
}

catalog_contract_kill() {
  local hits=""
  local file
  local pattern='\b(ef|e)\.crawl_target_id\b|SELECT[\s\S]{0,300}\bcrawl_target_id\b[\s\S]{0,300}FROM[[:space:]]+published_fee_catalog|FROM[[:space:]]+published_fee_catalog[\s\S]{0,300}\b(WHERE|AND|OR|GROUP BY|ORDER BY)[[:space:]]+(ef\.)?crawl_target_id\b'

  if git rev-parse --git-dir >/dev/null 2>&1; then
    while IFS= read -r file; do
      if perl -0ne "exit 0 if /$pattern/s; exit 1" "$file"; then
        hits+="${file}"$'\n'
      fi
    done < <(git ls-files --cached --others --exclude-standard -- src \
      | grep -E '\.(ts|tsx|js|mjs)$' \
      | grep -Ev '(^|/)(node_modules|__tests__)/|\.test\.(ts|tsx)$' || true)
  else
    while IFS= read -r file; do
      if perl -0ne "exit 0 if /$pattern/s; exit 1" "$file"; then
        hits+="${file}"$'\n'
      fi
    done < <(find src -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' \) \
      | grep -Ev '(^|/)(node_modules|__tests__)/|\.test\.(ts|tsx)$' || true)
  fi

  if [[ -n "$hits" ]]; then
    echo "catalog-contract-kill: published_fee_catalog consumers must use institution_id, not crawl_target_id:" >&2
    echo "$hits" >&2
    exit 1
  fi

  echo "catalog-contract-kill: OK (published fee catalog consumers use institution_id)"
  exit 0
}

legacy_data_contract_kill() {
  local hits=""
  local pattern='\bcrawl_(target|result|run|event)_id\b|\bcrawl(Target|Result|Run|Event)Id\b|\b(institution_financials|institution_complaints|branch_deposits|fee_change_events|fee_snapshots|analysis_results|fee_alert_subscriptions|agent_run_results|gold_standard_fees)\b'

  if git rev-parse --git-dir >/dev/null 2>&1; then
    hits=$(git grep --untracked -nE "$pattern" -- \
      src \
      ":(exclude)src/**/*.test.ts" \
      ":(exclude)src/**/*.test.tsx" \
      ":(exclude)src/**/__tests__/**" \
      | grep -v '^Binary file' || true)
  else
    hits=$(grep -R -nE "$pattern" src \
      --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
      --exclude='*.test.ts' --exclude='*.test.tsx' \
      --exclude-dir='__tests__' --exclude-dir='node_modules' 2>/dev/null || true)
  fi

  if [[ -n "$hits" ]]; then
    echo "legacy-data-contract-kill: active app code must use semantic institution_id views/functions:" >&2
    echo "$hits" >&2
    exit 1
  fi

  echo "legacy-data-contract-kill: OK (active app code uses semantic institution data contracts)"
  exit 0
}

brand_kill() {
  # Fee Insight is the site/company; Bank Fee Index is the product. Block copy that
  # names the site as the product, and stale bankfeeindex.com web references.
  # Also blocks identifiers from another brand (e.g. a crawler User-Agent naming it).
  # Allowed: hello@bankfeeindex.com (contact address) and the redirect in src/proxy.ts.
  local pattern='(AiBI-|theaibankinginstitute|\| Bank Fee Index["'"'"'`]|- Bank Fee Index["'"'"'`]|— Bank Fee Index["'"'"'`]|siteName: "Bank Fee Index"|Hamilton — Bank Fee Index|Welcome to Bank Fee Index|(https?://)?(www\.)?bankfeeindex\.com)'
  local hits=""

  if git rev-parse --git-dir >/dev/null 2>&1; then
    hits=$(git grep --untracked -nE "$pattern" -- \
      'src' ':(exclude)src/proxy.ts' ':(exclude)src/proxy.test.ts' ':(exclude)src/**/*.test.ts' ':(exclude)src/**/*.test.tsx' \
      | grep -v '^Binary file' | grep -v 'hello@bankfeeindex\.com' || true)
  else
    hits=$(grep -rnE "$pattern" \
      --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
      --exclude='proxy.ts' --exclude='proxy.test.ts' --exclude='*.test.ts' --exclude='*.test.tsx' \
      --exclude-dir=node_modules src 2>/dev/null | grep -v 'hello@bankfeeindex\.com' || true)
  fi

  if [[ -n "$hits" ]]; then
    echo "brand-kill: site named as the product or stale bankfeeindex.com reference (Fee Insight is the site; Bank Fee Index is the product):" >&2
    echo "$hits" >&2
    exit 1
  fi

  echo "brand-kill: OK (no site-as-product brand regressions)"
  exit 0
}

sql_placeholder_kill() {
  # A placeholder computed from the end of the params array breaks silently when a later
  # change pushes more params before it is used (the 4 Oct 2026 Rosetta read outage).
  local pattern='\$\$\{params\.length[[:space:]]*-'
  local hits=""
  if git rev-parse --git-dir >/dev/null 2>&1; then
    hits=$(git grep -nE "$pattern" -- src | grep -v '^Binary file' || true)
  else
    hits=$(grep -rnE "$pattern" --include='*.ts' --include='*.tsx' src 2>/dev/null || true)
  fi
  # Comments may name the pattern.
  hits=$(printf '%s\n' "$hits" | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|\*)' | grep -v '^$' || true)
  if [[ -n "$hits" ]]; then
    echo "sql-placeholder-kill: capture each placeholder when its param is pushed, e.g. const p = \`\$\${params.push(value)}\`:" >&2
    echo "$hits" >&2
    exit 1
  fi
  echo "sql-placeholder-kill: OK (no placeholders computed from params.length - N)"
}

heading_wrap_kill() {
  # Headings must never wrap one word onto its own line (James, 5 Oct 2026). The rule lives
  # once in the global stylesheet and once in the report template; per-page fixes drift.
  local missing=""
  for file in src/app/globals.css Reports/studio/template.html; do
    tr '\n' ' ' < "$file" | grep -qE 'h1, h2, h3, h4 \{[[:space:]]*text-wrap: ?balance' || missing+="$file"$'\n'
  done
  if [[ -n "$missing" ]]; then
    echo "heading-wrap-kill: keep 'h1, h2, h3, h4 { text-wrap: balance; }' (no one-word heading lines) in:" >&2
    printf '%s' "$missing" >&2
    exit 1
  fi
  echo "heading-wrap-kill: OK (headings balance their lines site-wide and in reports)"
}

case "$SUBCOMMAND" in
  sqlite-kill) sqlite_kill ;;
  modal-kill) modal_kill ;;
  legacy-kill) legacy_kill ;;
  fee-read-model-kill) fee_read_model_kill ;;
  script-kill) script_kill ;;
  config-kill) config_kill ;;
  edge-function-kill) edge_function_kill ;;
  artifact-kill) artifact_kill ;;
  provider-kill) provider_kill ;;
  prompt-kill) prompt_kill ;;
  active-doc-kill) active_doc_kill ;;
  migration-history-kill) migration_history_kill ;;
  legacy-name-kill) legacy_name_kill ;;
  source-read-model-kill) source_read_model_kill ;;
  agent-source-contract-kill) agent_source_contract_kill ;;
  fee-tier-contract-kill) fee_tier_contract_kill ;;
  catalog-contract-kill) catalog_contract_kill ;;
  legacy-data-contract-kill) legacy_data_contract_kill ;;
  brand-kill) brand_kill ;;
  sql-placeholder-kill) sql_placeholder_kill ;;
  heading-wrap-kill) heading_wrap_kill ;;
  "")
    echo "Usage: $0 <sqlite-kill|modal-kill|legacy-kill|fee-read-model-kill|script-kill|config-kill|edge-function-kill|artifact-kill|provider-kill|prompt-kill|active-doc-kill|migration-history-kill|legacy-name-kill|source-read-model-kill|agent-source-contract-kill|fee-tier-contract-kill|catalog-contract-kill|legacy-data-contract-kill|brand-kill|sql-placeholder-kill|heading-wrap-kill>" >&2
    exit 2
    ;;
  *)
    echo "Unknown subcommand: $SUBCOMMAND" >&2
    echo "Usage: $0 <sqlite-kill|modal-kill|legacy-kill|fee-read-model-kill|script-kill|config-kill|edge-function-kill|artifact-kill|provider-kill|prompt-kill|active-doc-kill|migration-history-kill|legacy-name-kill|source-read-model-kill|agent-source-contract-kill|fee-tier-contract-kill|catalog-contract-kill|legacy-data-contract-kill|brand-kill|sql-placeholder-kill|heading-wrap-kill>" >&2
    exit 2
    ;;
esac
