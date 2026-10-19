# Test-toolchain mock and Windows path guards

2026-10-19. Foundation #1048, scoped outcome #2191.

Vitest/mocker 4.1.3 and Vite 8.0.7 resolved advisory-affected development code.
Vite 8.0.15 is the affected upper bound, not the version that was installed.
This updates compatible minimums to Vitest and its seven exact-version children
4.1.11 and Vite 8.0.16, within existing direct and parent ranges.

## Primary evidence and actual applicability

[Vitest's advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9)
identifies the standalone mocker's missing file-serving allowlist check. Its
unauthenticated HMR registration can expose local files when that development server
is reachable; Vitest's browser RPC instead uses a per-run token. The maintained-major
[4.1.11 release](https://github.com/vitest-dev/vitest/releases/tag/v4.1.11) includes the
[actual allowlist backport](https://github.com/vitest-dev/vitest/commit/fe5a11d3c).

[Vite's primary advisory](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff)
describes Windows ADS and short-name spellings bypassing denied-file matching.
[Launch-editor's primary advisory](https://github.com/vitejs/launch-editor/security/advisories/GHSA-v6wh-96g9-6wx3)
describes Windows UNC authentication disclosure. Vite bundles this helper; an unrelated
installed package with the same name would not prove that Vite's embedded code changed.
The actual old and target distributed bundles were inspected.

The reviewed application dev/start commands use Next. Direct Vite/Vitest/mocker imports
in source belong to tests. The actual test config uses jsdom, aliases and setup, and CI
uses Node 22 with run/shards. No standalone mocker plugin, browser/API mode or external
test-server bind was found in those configured paths. This is preventative test/development
maintenance, not a demonstrated deployed request exploit or Windows incident.

## Exactly the required dependency family

Only 33 lock nodes change: 30 existing nodes and three required nested optional wasm
nodes; none is removed. Root declarations, application source/configuration and all
unrelated dependency objects/text stay unchanged, including the browser backport archive,
framework, PostCSS, XML and SDK families.

- Vitest and seven coupled children become 4.1.11.
- Vite 8.0.16 requires exact Rolldown 1.0.3 and 15 matching optional platform bindings,
  Oxc types 0.133.0, pluginutils 1.0.0 and tinyglobby 0.2.17.
- Tinyglobby's raised range requires its existing nested Picomatch 4.0.3 to become 4.0.4.
  Other Picomatch paths are preserved.
- The optional wasm binding needs nested Emnapi core/runtime 1.10.0 and wasi-threads
  1.2.1, plus its existing nested napi wasm-runtime 1.1.4. Other native families keep
  their exact dependencies.

Node requirements do not rise versus current Vite: Vite/Rolldown require Node 20.19 or
22.12+, and Vitest supports Node 20/22/24+. The observed Node 22.20 and CI Node 22 fit.
No major/downgrade, override, lifecycle hook, peer bypass or CLI removal is introduced.

## Meaningful safety and compatibility proof

Before the lock changed, the actual installed suite failed seven intended safety
assertions and passed five ordinary/native controls. The mocker tests register through
the actual callback and load hook against actual Vite-resolved configuration. Owned
synthetic outside-root and denied `.env` markers reproduce the defect without a server.
Allowed zero-valued module source and registration acknowledgement remain usable.

Windows controls extract the **unmodified actual bundled** deny-check function and CJS
launch-editor closure into a VM with explicit platform/allowlist/filesystem/process
adapters. They cover ADS, short names and UNC rejection alongside ordinary drive paths
and deny matches. No adapter opens a real UNC path or launches an editor. These are
selected Windows branch controls, **not actual NTFS, SMB, HTTP or Windows acceptance**.
The installed Vite public guard and real native Oxc transform/Rolldown virtual-module
bundle independently preserve ordinary paths and zero. No listener or external request
is needed, and every fixture directory is owned and removed.

The external compatibility assessment also ran ten unchanged actual app suites at
`53fd0eb4d`: 129 passed, zero skips, covering mock/DOM/auth/map/audience/SDK/tooling
contracts. The implementation branch starts at `4da1c2a80`; its dependency/config/vendor
inputs match that assessment, and its own complete release gates are recorded separately.

Npm 10.9.3's lock-only resolver crashed in optional-peer loading, including an isolated
two-dependency project. Those failures are preserved. The preview instead uses exact
official registry metadata for required minimum nodes. Its first default `ci` correctly
rejected the missing raised nested Picomatch edge; that evidence is retained too. With
that required edge, ordinary and ignore-scripts default clean installs pass with the
original root manifest. No peer-check bypass or install hook conceals the failure.

**Guard:** `src/lib/test-toolchain-security.test.ts` exercises actual mock registration/load,
allowed/denied files, bundled Windows guards and UNC handling, installed public guard and
matching native transform/bundle compatibility. Existing auth/proxy/DOM, audience, SDK,
tooling and source-map suites provide ordinary consumer coverage. Release receipts record
clean repeated installs, selected official archive/SRI/installed bytes and parent resolution,
the current SQL/full/agentic/static gates, isolated build/14 canonical routes, exact independent
review and required CI. No production/provider/bank/storage/settings or migration action.

## Residual scope

The preview audit measures full **29→26**, production **1→1**: only Vitest, mocker and
Vite package entries disappear. Vitest and mocker share an advisory; package entries are
not unique exploit counts. The only retained-object exception is Picomatch losing the
now-patched tinyglobby nested path; all its other fields and every other retained advisory
object match. The truthful baseline-browser version flag after its behavior backport,
other development families, practical AI response budgets and broader egress remain separate.
