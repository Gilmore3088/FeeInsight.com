/** Independent literal closure inventory approved from the eager CLI/runner imports and install inputs. */
export const CURRENT_PROOF_INPUTS = [
  '.gitattributes',
  '.github/workflows/engineering-verification.yml',
  'package.json',
  'package-lock.json',
  'vendor/baseline-browser-mapping/baseline-browser-mapping-2.9.19-process-error-backport.tgz',
  'src/lib/engineering-verification/cli.mjs',
  'src/lib/engineering-verification/contract.mjs',
  'src/lib/engineering-verification/runner.mjs',
  'src/lib/engineering-verification/github.mjs',
  'src/lib/engineering-verification/proof.mjs',
  'src/lib/engineering-verification/evidence.mjs',
  'src/lib/engineering-verification/program.mjs',
  'src/lib/engineering-verification/scope.mjs',
  'src/lib/engineering-verification/events.mjs',
  'src/lib/engineering-verification/scorecard.mjs',
  'src/lib/engineering-verification/contract-registry.mjs',
  'src/lib/engineering-verification/pilot.mjs',
  'src/lib/engineering-verification/policy-pilot.mjs',
  'src/lib/engineering-verification/policy-v2-pilot.mjs',
  'src/lib/engineering-verification/child.mjs',
  'src/lib/engineering-verification/loader.mjs',
  'src/lib/engineering-verification/policy.json',
  'src/lib/engineering-verification/runtime.json',
  'src/lib/engineering-verification/__fixtures__/knox-2285.json',
  'src/lib/engineering-verification/__fixtures__/policy-1048.json',
  'src/lib/engineering-verification/__fixtures__/policy-v2.json',
].sort();
export const FORBIDDEN_PROOF_INPUTS = [
  '.npmrc', 'npm-shrinkwrap.json',
  'src/package.json', 'src/lib/package.json', 'src/lib/engineering-verification/package.json',
  'src/node_modules', 'src/lib/node_modules', 'src/lib/engineering-verification/node_modules',
  '.github/.gitattributes', '.github/workflows/.gitattributes',
  'docs/.gitattributes', 'docs/project/.gitattributes', 'docs/project/acceptance/.gitattributes',
  'docs/project/acceptance/engineering/.gitattributes', 'docs/project/acceptance/engineering/design-v1/.gitattributes',
  'src/.gitattributes', 'src/lib/.gitattributes', 'src/lib/agents/.gitattributes', 'src/lib/agents/hoovie/.gitattributes',
  'src/lib/engineering-verification/.gitattributes', 'src/lib/engineering-verification/__fixtures__/.gitattributes',
  'vendor/.gitattributes', 'vendor/baseline-browser-mapping/.gitattributes',
].sort();
export const HISTORICAL_PROOF_SOURCE = 'd28d77a4da9d2fb6edc73d8c264e42a7e380ae77';
export function completeProofFiles(files: Record<string, string>) {
  for (const path of CURRENT_PROOF_INPUTS) files[path] ??= 'Synthetic closed input: ' + path;
  return files;
}
