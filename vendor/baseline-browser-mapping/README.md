# Baseline browser mapping error backport

This is `baseline-browser-mapping` **2.9.19**, by the W3C WebDX Community Group
and contributors, under the included Apache-2.0 license. Its original package
metadata, README, license, CLI, types and browser data are retained. The two
modified distribution files each carry a dated modification notice.

The archive backports the catchable-error behavior from [upstream PR 137](https://github.com/web-platform-dx/baseline-browser-mapping/pull/137)
for [CVE-2026-45819](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv).
Each distribution has two replacements: the invalid KaiOS configuration and
mutually exclusive year/date options throw the original specific `Error` instead
of logging it and calling `process.exit(1)`. Validation placement and warning
options remain as in 2.9.19. The CLI still exits nonzero for invalid options; its
invalid-error stdout/stderr is not byte-identical.

The project lock resolves this checked-in, integrity-pinned tarball. There is no
override, lifecycle hook, new dependency or application configuration. Regenerating
the lock can discard this resolution: the installed-byte, real-parent-resolution
and behavior tests must continue to pass. Prefer a future reviewed upstream release
when it passes the existing downstream engine compatibility controls.

Published 2.11.0, 2.11.1 and 2.11.29 pass the process-safety controls but retain stale
downstream engine minima after later core-browser bumps. For example, their 2024
selection includes QQ/Blink 121, UC/Blink 123 and KaiOS/Gecko 123 against Chrome 130
and Firefox 132. This backport preserves the original data and correct selection.
It does not claim an application-controlled invocation or an input sandbox. The
truthful original version remains affected in version-based npm audits; no audit
suppression or scanner clearance is asserted.

## Reproduce and review

`provenance.json` records the registry URL/SRI, exact four source replacements,
modification notice, every original/final package-file hash and final archive SRI.
The archive has only the original seven package files; no install script is added.
Use Node 22.20.0 and npm 10.9.3 (the recorded toolchain) from this repository root.
The following writes only to a disposable directory:

```sh
TASK_BASELINE_DIR="$(mktemp -d)"
export TASK_BASELINE_DIR
node --input-type=module <<'JS'
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const p = JSON.parse(readFileSync('vendor/baseline-browser-mapping/provenance.json'));
const bytes = Buffer.from(await (await fetch(p.originalRegistry['dist.tarball'])).arrayBuffer());
const sri = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
if (sri !== p.originalRegistry['dist.integrity']) throw Error('Original SRI mismatch');
mkdirSync(process.env.TASK_BASELINE_DIR, { recursive: true });
writeFileSync(process.env.TASK_BASELINE_DIR + '/original.tgz', bytes);
JS
tar -xzf "$TASK_BASELINE_DIR/original.tgz" -C "$TASK_BASELINE_DIR"
node --input-type=module <<'JS'
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const p = JSON.parse(readFileSync('vendor/baseline-browser-mapping/provenance.json'));
const hash = value => createHash('sha256').update(value).digest('hex');
for (const change of p.changes) {
  const file = process.env.TASK_BASELINE_DIR + '/package/' + change.file;
  let source = readFileSync(file, 'utf8');
  if (hash(source) !== change.originalSha256) throw Error('Preimage mismatch');
  for (const replacement of change.replacements) {
    if (source.split(replacement.before).length !== 2) throw Error('Replacement count');
    source = source.replace(replacement.before, replacement.after);
  }
  source = change.notice + source;
  if (hash(source) !== change.patchedSha256) throw Error('Patched hash mismatch');
  writeFileSync(file, source);
}
for (const unchanged of p.unchangedPackageFiles) {
  const bytes = readFileSync(process.env.TASK_BASELINE_DIR + '/package/' + unchanged.file);
  if (hash(bytes) !== unchanged.sha256) throw Error('Unchanged file mismatch');
}
JS
(cd "$TASK_BASELINE_DIR/package" && npm pack --ignore-scripts)
node --input-type=module <<'JS'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const p = JSON.parse(readFileSync('vendor/baseline-browser-mapping/provenance.json'));
const bytes = readFileSync(process.env.TASK_BASELINE_DIR + '/package/baseline-browser-mapping-2.9.19.tgz');
if ('sha512-' + createHash('sha512').update(bytes).digest('base64') !== p.archive.integrity) {
  throw Error('Archive SRI mismatch');
}
console.log('Reproduced reviewed archive');
JS
```

Run `npm ci` (also verified with `--ignore-scripts`) and
`npx vitest run src/lib/baseline-browser-security.test.ts`. The full-output golden
hashes were generated from integrity-verified original 2.9.19 CJS and ESM exports
at the recorded UTC clock; tests pin that clock instead of depending on the day.
The seven ordinary API outputs and fixed-year CLI output must remain identical.
