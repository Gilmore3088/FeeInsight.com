// @vitest-environment node
/** Independent metadata-only admission cases. No Git commands or source/blob reads. */
import { describe, expect, it } from 'vitest';
import { planDraftSourceInventory } from './board-brief-runner.mjs';

const BLOB = '1111111111111111111111111111111111111111';
const OTHER = '2222222222222222222222222222222222222222';
const MIB = 1024 * 1024;
const PROD = 'src/lib/hamilton/board-brief.ts';
// This is the literal ls-tree -r -l -z record grammar, not a Git-produced fixture.
const record = (path: string, bytes = 12, mode = '100644', blob = BLOB, type = 'blob') => `${mode} ${type} ${blob} ${bytes}\t${path}\0`;
const valid = `100644 blob 1111111111111111111111111111111111111111 12\tsrc/lib/hamilton/board-brief.ts\0`;
const selected = (path = PROD, bytes = 12, mode = '100644', blob = BLOB) => ({ path, mode, blob, bytes });

describe('independent literal Git inventory planning before any blob read', () => {
  it('admits a regular production blob with exact literal metadata and selected-byte count', () => {
    expect(planDraftSourceInventory(valid)).toEqual({ selected: [selected()], excluded: {}, entries: 1, totalBytes: 12 });
  });

  it('preserves two distinct modes/blob identities, including zero-length regular production source', () => {
    const input = record('src/components/hamilton/reports/BoardBriefEditor.tsx', 0)
      + record(PROD, 23, '100755', OTHER);
    expect(planDraftSourceInventory(input)).toEqual({
      selected: [selected('src/components/hamilton/reports/BoardBriefEditor.tsx', 0), selected(PROD, 23, '100755', OTHER)],
      excluded: {}, entries: 2, totalBytes: 23,
    });
  });

  it('accepts byte-form listing without interpreting paths as commands or loading contents', () => {
    expect(planDraftSourceInventory(new TextEncoder().encode(valid))).toEqual({ selected: [selected()], excluded: {}, entries: 1, totalBytes: 12 });
  });

  it('allows repeated identically spelled ancestor directories', () => {
    const input = record('src/lib/Hamilton/a.ts', 2) + record('src/lib/Hamilton/b.ts', 3);
    expect(planDraftSourceInventory(input)).toEqual({
      selected: [selected('src/lib/Hamilton/a.ts', 2), selected('src/lib/Hamilton/b.ts', 3)],
      excluded: {}, entries: 2, totalBytes: 5,
    });
  });

  it.each([
    'src/lib/hamilton/test-fixtures/navy-comparable-peers-2ce4.json',
    'src/lib/agents/rosetta/test-fixtures/oakwood-fees.pdf',
    'src/lib/agents/knox/fixtures/cascade-paid-returned-13277.txt',
    'src/lib/hamilton/board-brief-quality.fixture.ts',
    'src/lib/hamilton/committee-packet.fixture.ts',
    'src/lib/hamilton/workspace/test-fixtures.ts',
    'src/lib/non-deposit-document.fixtures.ts',
    'src/lib/agents/learning/document-kind.fixtures.ts',
    'src/lib/regulatory/fed-board-fixtures.ts',
    'src/lib/agents/deming/regression-fixture.ts',
    'src/components/hamilton/storyline/test-fixture.ts',
    'src/lib/agents/learning/fixtures-product-pages-2026-10-12.json',
    'src/lib/__fixtures__/wire-channel-names.ts',
    'src/lib/__tests__/helpers.ts',
    'src/lib/tests/helpers.ts',
    'src/lib/test/helpers.ts',
    'src/lib/Fixtures/case.ts',
    'src/lib/test_fixtures/case.ts',
    'src/lib/private/secret.json',
    'src/private/expectations.json',
    'src/lib/__private__/expectations.json',
    'src/lib/.private/expectations.json',
    'src/lib/holdout/unknown.json',
    'src/lib/private-holdouts/unknown.json',
    'src/lib/PRIVATE/expectations.json',
  ])('excludes fixture/private metadata before it can become a selected blob: %s', path => {
    expect(planDraftSourceInventory(valid + record(path, 7))).toEqual({
      selected: [selected()], excluded: { 'test-fixture-holdout': { count: 1, bytes: 7 } }, entries: 2, totalBytes: 12,
    });
  });

  it.each([
    ['verifier-control', 'src/lib/engineering-verification/board-brief-draft.mjs'],
    ['verifier-control', 'src/lib/engineering-verification/__fixtures__/hamilton-board-brief-975-v1.json'],
    ['verifier-control', 'src/lib/engineering-verification/hamilton-board-brief-pilot.test.ts'],
    ['candidate-test', 'src/lib/hamilton/board-brief.test.ts'],
    ['candidate-test', 'src/components/hamilton/reports/BoardBriefEditor.spec.tsx'],
    ['candidate-test', 'src/lib/check.test.mjs'],
    ['candidate-test', 'src/lib/continuity.pw.ts'],
    ['resolver-override', 'src/node_modules/injected/index.js'],
    ['resolver-override', 'src/lib/.git/config'],
    ['candidate-config', 'src/package.json'],
    ['candidate-config', 'src/lib/package-lock.json'],
    ['candidate-config', 'src/lib/npm-shrinkwrap.json'],
    ['candidate-config', 'src/lib/.npmrc'],
    ['candidate-config', 'src/lib/.gitattributes'],
    ['candidate-config', 'src/lib/.env.local'],
    ['candidate-config', 'src/tsconfig.json'],
    ['candidate-config', 'src/jsconfig.paths.json'],
  ])('excludes %s input %s without its contents or digest', (reason, path) => {
    const planned = planDraftSourceInventory(valid + record(path, 9));
    expect(planned).toEqual({ selected: [selected()], excluded: { [reason]: { count: 1, bytes: 9 } }, entries: 2, totalBytes: 12 });
    expect(JSON.stringify(planned.excluded)).not.toContain(BLOB);
    expect(JSON.stringify(planned.excluded)).not.toContain(path);
  });

  it('counts several excluded entries without retaining their identities or charging them to selected bytes', () => {
    const planned = planDraftSourceInventory(valid + record('src/private/one.json', 30)
      + record('src/lib/fixtures/two.txt', 40) + record('src/lib/board-brief.test.ts', 50));
    expect(planned).toEqual({
      selected: [selected()], excluded: { 'test-fixture-holdout': { count: 2, bytes: 70 }, 'candidate-test': { count: 1, bytes: 50 } },
      entries: 4, totalBytes: 12,
    });
  });

  it.each([
    ['whole filename alias', record('src/lib/A.ts') + record('src/lib/a.ts')],
    ['ancestor alias with distinct filenames', record('src/Case/a.ts') + record('src/case/b.ts')],
    ['deeper ancestor alias', record('src/lib/Hamilton/a.ts') + record('src/lib/hamilton/b.ts')],
    ['file and case-alias directory', record('src/Thing') + record('src/thing/child.ts')],
    ['identical full path', record(PROD) + record(PROD)],
    ['excluded ancestor alias', valid + record('src/__fixtures__/Case/a.json') + record('src/__fixtures__/case/b.json')],
  ])('rejects %s before filtering or selecting any blobs', (_label, input) => {
    expect(() => planDraftSourceInventory(input)).toThrow();
  });

  it.each([
    ['symlink mode', record('src/link.ts', 3, '120000')],
    ['excluded symlink mode', valid + record('src/__fixtures__/link.ts', 3, '120000')],
    ['gitlink', '160000 commit 1111111111111111111111111111111111111111 -\tsrc/submodule\0'],
    ['unrecognized mode', record(PROD, 3, '100664')],
    ['tree object with file mode', record(PROD, 3, '100644', BLOB, 'tree')],
    ['invalid object identity', record(PROD, 3, '100644', 'z'.repeat(40))],
    ['short object identity', record(PROD, 3, '100644', '1'.repeat(39))],
    ['negative length', `100644 blob ${BLOB} -1\t${PROD}\0`],
    ['fractional length', `100644 blob ${BLOB} 1.5\t${PROD}\0`],
    ['unsafe integer length', `100644 blob ${BLOB} 9007199254740992\t${PROD}\0`],
    ['absolute path', record('/src/lib/a.ts')],
    ['outside src', record('docs/oracle.json')],
    ['root package', record('package.json')],
    ['parent traversal', record('src/../oracle.ts')],
    ['dot component', record('src/./a.ts')],
    ['empty component', record('src//a.ts')],
    ['backslash path', record('src/lib\\oracle.ts')],
    ['control newline', record('src/lib/a\nb.ts')],
    ['control tab', record('src/lib/a\tb.ts')],
    ['noncanonical Unicode', record('src/lib/cafe\u0301.ts')],
    ['oversized relative path', record('src/' + 'x'.repeat(1021))],
    ['missing NUL terminator', valid.slice(0, -1)],
    ['extra empty record', valid + '\0'],
    ['empty listing', ''],
    ['non-tree prose', 'PASS: source is safe\0'],
  ])('rejects invalid tree metadata: %s', (_label, input) => {
    expect(() => planDraftSourceInventory(input)).toThrow();
  });

  it('rejects malformed UTF-8 rather than replacing filename bytes', () => {
    expect(() => planDraftSourceInventory(new Uint8Array([0xff, 0xfe, 0]))).toThrow();
  });

  it('accepts the exact selected-file byte bound', () => {
    expect(planDraftSourceInventory(record(PROD, 2 * MIB))).toEqual({ selected: [selected(PROD, 2 * MIB)], excluded: {}, entries: 1, totalBytes: 2 * MIB });
  });

  it('rejects an oversized selected file before reading its blob', () => {
    expect(() => planDraftSourceInventory(record(PROD, 2 * MIB + 1))).toThrow();
  });

  it('accepts exact selected total bytes and rejects one additional selected byte', () => {
    const exact = Array.from({ length: 32 }, (_, index) => record(`src/production/f-${index}.ts`, 2 * MIB)).join('');
    const planned = planDraftSourceInventory(exact);
    expect(planned.selected).toHaveLength(32);
    expect(planned.totalBytes).toBe(64 * MIB);
    expect(() => planDraftSourceInventory(exact + record('src/production/extra.ts', 1))).toThrow();
  });

  it('bounds excluded metadata independently without requesting excluded blob bytes', () => {
    expect(planDraftSourceInventory(valid + record('src/private/large.json', 64 * MIB))).toEqual({
      selected: [selected()], excluded: { 'test-fixture-holdout': { count: 1, bytes: 64 * MIB } }, entries: 2, totalBytes: 12,
    });
    expect(() => planDraftSourceInventory(valid + record('src/private/large.json', 64 * MIB + 1))).toThrow();
  });

  it('accepts exactly 5000 selected metadata entries and rejects 5001', () => {
    const exact = Array.from({ length: 5000 }, (_, index) => record(`src/production/f-${index}.ts`, 1)).join('');
    expect(planDraftSourceInventory(exact).selected).toHaveLength(5000);
    expect(() => planDraftSourceInventory(exact + record('src/production/extra.ts', 1))).toThrow();
  });

  it('accepts exactly 10000 total metadata entries and rejects 10001, including excluded entries', () => {
    const exact = valid + Array.from({ length: 9999 }, (_, index) => record(`src/__fixtures__/f-${index}.json`, 1)).join('');
    const planned = planDraftSourceInventory(exact);
    expect(planned.entries).toBe(10000);
    expect(planned.excluded).toEqual({ 'test-fixture-holdout': { count: 9999, bytes: 9999 } });
    expect(() => planDraftSourceInventory(exact + record('src/__fixtures__/extra.json', 1))).toThrow();
  });
});
