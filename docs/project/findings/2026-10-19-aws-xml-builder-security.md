# AWS XML builders: verify bundled behavior as well as advisory versions

Issue: [#2171](https://github.com/Gilmore3088/FeeInsight.com/issues/2171), under Foundation #1048.

## Cause and applicability

The S3 dependency chain installed `@aws-sdk/xml-builder@3.972.16`,
`fast-xml-parser@5.5.8` and `fast-xml-builder@1.1.4`. The
[attribute advisory](https://github.com/NaturalIntelligence/fast-xml-builder/security/advisories/GHSA-5wm8-gmm8-39j9)
concerns quote injection when building attributes with entity processing disabled.
The [comment/CDATA advisory](https://github.com/NaturalIntelligence/fast-xml-parser/security/advisories/GHSA-gh4j-gqv2-49f6)
concerns delimiter injection during XML building. These two underlying advisories
produce three npm package entries through propagation to the AWS wrapper.

Application S3 calls in document-vault, Hoovie cold files, report rendering and
report download signing use HeadObject, GetObject, PutObject and presigning. AWS
core uses the wrapper's `parseXML` and its own escaped `XmlNode`/`XmlText` classes.
No direct application import or invocation of the affected fast-xml builder
features was found. Successful raw GetObject bytes are not XML-parsed. This is
runtime dependency maintenance; no deployed vulnerable-builder path or exploit
has been established.

## Selected compatible patch

The scanner-minimum wrapper `3.972.19` pins parser `5.7.1`. Tiny actual-library
probes show that parser's CommonJS bundle still embeds the old quote behavior
even when the external builder is `1.1.7`; its ESM path uses the fixed external
builder. Wrapper `3.972.20` / parser `5.7.2` has the same distinction. A version-only
audit would miss that behavior. The old CommonJS failures and module-path matrix
are retained in the review evidence.

Wrapper `3.972.24` is the first published wrapper pinning parser `5.7.3`, whose
[maintainer release](https://github.com/NaturalIntelligence/fast-xml-parser/releases/tag/v5.7.3)
updates the bundled builder to `1.1.7`. Actual CommonJS and ESM quote/comment/CDATA
controls all pass with this chain. It fits core's existing `^3.972.16` range and
retains the parser. The parser-removing wrapper introduced at `3.972.31` is a
separate change and is not selected here.

Exactly seven lock nodes change or are added:

| Dependency | Before | Selected |
| --- | --- | --- |
| `@aws-sdk/xml-builder` | `3.972.16` | `3.972.24` |
| `fast-xml-parser` | `5.5.8` | `5.7.3` |
| `fast-xml-builder` | `1.1.4` | `1.1.7` |
| `@smithy/types` | `4.14.0` | `4.14.1` |
| `strnum` | `2.2.2` | `2.2.3` |
| `path-expression-matcher` | `1.2.1` | `1.5.0` |
| `@nodable/entities` | absent | `2.1.0` |

These leaves satisfy the selected packages' exact dependencies or minimum ranges;
the AWS wrapper requires entities `2.1.0` exactly. The Node >=20 requirement is
unchanged. Package metadata and registry integrity select the lock nodes; clean
`npm ci` verifies the resulting graph. `package.json`, S3 client/core/presigner,
all unrelated lock entries and application runtime source remain unchanged.
No overrides or provider/storage settings are added.

The wrapper adds an AWS entity-decoder shim. Its own XmlNode/XmlText serialization
source is unchanged. Existing entity expansion, nesting and response-body resource
policies are also unchanged: this patch is not an XML sandbox or a new XML memory
budget. Provider response budgets and other advisory families remain separate work.

## Verification and residual findings

The original installed packages fail six actual Node conditional-export cases:
quote, comment and CDATA injection in both CommonJS and ESM. Six positive controls
for escaping, financial zero/false/empty values and existing entities pass. All
twelve pass after the patch, using tiny strings and real package resolution rather
than copied implementations or browser rendering.

Sixteen actual-wrapper/SDK compatibility cases cover namespaces, arrays, zero,
empty values, Unicode, CRLF and currency entities; escaping and malformed XML;
HeadObject metadata and 404; raw binary GetObject data; XML error messages/status/
request IDs; zero-byte PutObject and typed refusals; document-vault missing/duplicate/
failure/read behavior; cold-file bytes; SDK presigning and the application's report
signing contract. A custom in-memory request handler supplies synthetic responses
to the real S3 client. Signing uses synthetic credentials and sends no request.
Existing vault, cold-file and report-render tests also pass. No real storage read
or write, credential access, provider call or production data request is made.

Separate clean installs and full-lock audit snapshots verify the result. The full
npm audit changes from 38 package entries (0 critical, 26 high, 10 moderate, 2 low)
to 35 (0 critical, 25 high, 8 moderate, 2 low). Production changes from 7 (0 critical,
2 high, 5 moderate) to 4 (0 critical, 1 high, 3 moderate). Only the three XML family
entries disappear; every other advisory object is identical. These are package
entries, not independently demonstrated exploits. Exact-head receipts record the
broader repository gates and isolated production build.

**Guard:** `src/lib/aws-xml-builders.test.ts` runs the installed CommonJS and ESM
exports against quote/comment/CDATA regressions and positive controls;
`src/lib/aws-xml-s3-compatibility.test.ts` verifies the actual wrapper, in-memory S3
protocol and application storage/signing contracts. Both run in ordinary Vitest CI.
