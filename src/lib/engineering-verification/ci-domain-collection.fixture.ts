/** TEST ONLY: synthetic metadata and literal bytes; never executes a reader or Docker. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { BatchManifest, CaptureRecord, ArtifactIdentity } from './ci-domain-collection.mjs';
import { READER_IMAGE } from './ci-domain-collection.mjs';

const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const ROOT = new URL('./', import.meta.url);
const SOURCE = 'src/lib/engineering-verification/github.mjs';
const OWNER = 'org.feeinsight.verification.owner', KIND = 'org.feeinsight.verification.kind', CASE = 'org.feeinsight.verification.case';

export function syntheticNativeFixture(seed = 'literal-test-fixture', batchId = 'reader-01-32') {
  const id = sha(seed), token = sha('owner:' + seed);
  const uuid = (text: string) => text.slice(0, 8) + '-' + text.slice(8, 12) + '-' + text.slice(12, 16) + '-' + text.slice(16, 20) + '-' + text.slice(20, 32);
  const identity = { containerId: id, name: 'verification-reader-' + uuid(sha('name:' + seed)), owner: uuid(token), batchId };
  const harness = '/synthetic-owned-' + id.slice(0, 16) + '/owned-harness';
  const image = { Id: 'sha256:' + 'c'.repeat(64), RepoDigests: [READER_IMAGE], Architecture: 'arm64', Os: 'linux',
    Config: { Env: ['PATH=/usr/local/bin:/usr/bin:/bin', 'NODE_VERSION=22.16.0', 'YARN_VERSION=1.22.22'],
      Entrypoint: ['docker-entrypoint.sh'], Cmd: ['node'], Labels: {} } };
  const builtin = { Id: 'b'.repeat(64), Name: 'none', Driver: 'null', Scope: 'local' };
  const labels = { [CASE]: batchId, [KIND]: 'offline-reader-values', [OWNER]: identity.owner };
  const native = { Id: id, Name: '/' + identity.name, Image: image.Id,
    Config: { Image: READER_IMAGE, User: '65534:65534', WorkingDir: '/tmp', Cmd: ['node', '/harness/child.mjs'],
      Env: [...image.Config.Env], Labels: labels, Entrypoint: image.Config.Entrypoint, Tty: false },
    State: { Status: 'created', Running: false, Pid: 0, ExitCode: 0, OOMKilled: false },
    NetworkSettings: { SandboxID: '', SandboxKey: '', Networks: { none: { NetworkID: '', EndpointID: '', IPAddress: '', Gateway: '',
      IPv6Gateway: '', GlobalIPv6Address: '', MacAddress: '', IPPrefixLen: 0, GlobalIPv6PrefixLen: 0, Aliases: null,
      Links: null, DNSNames: null, DriverOpts: null, IPAMConfig: null } }, Ports: {} },
    HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, Privileged: false, CapDrop: ['ALL'], CapAdd: null,
      SecurityOpt: ['no-new-privileges'], PidsLimit: 128, Memory: 805306368, MemorySwap: 805306368, NanoCpus: 1000000000,
      AutoRemove: false, PublishAllPorts: false, RestartPolicy: { Name: 'no', MaximumRetryCount: 0 },
      PortBindings: {}, Devices: [], DeviceRequests: [], DeviceCgroupRules: [], ExtraHosts: [], Links: null,
      Dns: [], DnsOptions: [], DnsSearch: [], VolumesFrom: [], GroupAdd: [], PidMode: '', IpcMode: 'private', UTSMode: '',
      Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=32m' } },
    Mounts: [{ Type: 'bind', Source: harness, Destination: '/harness', RW: false }] };
  return { identity, harness, image, builtin, native };
}

function oldLiteralReader(current: Buffer): Buffer {
  if (sha(current) !== 'c8f38170161437f105d67f5b9b9c69871c5587ff03bed3b0db6c9013cfbe7e88') throw new Error('Test source reader changed prospectively');
  let text = current.toString();
  text = text.replace('  const ciProblems = [];\n  let validatedHistoricalContext = false;\n', '');
  text = text.replace("    if (head.sha !== headSha || merge.sha !== pr.merge_commit_sha || !isSha(head.tree?.sha) || !isSha(merge.tree?.sha)) throw new Error('Native head and merge commit trees are missing or not identical');\n    validatedHistoricalContext = true;\n    if (head.tree.sha !== merge.tree.sha) {\n      ciProblems.push('Native head and merge commit trees are not identical');\n      return null;\n    }\n",
    "    if (head.sha !== headSha || merge.sha !== pr.merge_commit_sha || !isSha(head.tree?.sha) || head.tree.sha !== merge.tree?.sha) throw new Error('Native head and merge commit trees are missing or not identical');\n");
  text = text.replace("  if (!association || (!directAssociation(run)", "  const ciProblems = [];\n  if (!association || (!directAssociation(run)");
  text = text.replace("  if (validatedHistoricalContext) {\n    const associations = await capture('current historical CI association', () => pages(`/commits/${headSha}/pulls`), null);\n    if (!matchesHistoricalAssociation(associations)) {\n      const problem = 'Historical native commit association changed or could not be rechecked while collecting evidence';\n      problems.push(problem);\n      ciProblems.push(problem);\n    }\n  }",
    "  if (historicalIdentity) {\n    const associations = await capture('current historical CI association', () => pages(`/commits/${headSha}/pulls`), null);\n    if (!matchesHistoricalAssociation(associations)) ciProblems.push('Historical native commit association changed while collecting evidence');\n  }");
  text = text.replace("  if (historical && (!sameMergedPr(current)", "  if (historicalIdentity && (!sameMergedPr(current)");
  const result = Buffer.from(text);
  if (sha(result) !== '87a9210baf62c30dab3e3b83863a6b9399cafd6159755b239bbc80ffdd0e996d') throw new Error('Literal historical test byte reconstruction differs');
  return result;
}

export interface SyntheticBatchOptions {
  sourceRef?: string; sourceSha256?: string; batchId?: string; caseIds?: string[];
  childSha256?: string; collectionSha256?: string; parserSha256?: string;
  sourceBytes?: Buffer; outputBytes?: Buffer; seed?: string;
}

export function syntheticBatchEvidence(options: SyntheticBatchOptions = {}) {
  const batchId = options.batchId ?? 'reader-01-32';
  const caseIds = options.caseIds ?? Array.from({ length: batchId === 'reader-01-32' ? 32 : 7 }, (_, index) => 'reader-' + String(index + (batchId === 'reader-01-32' ? 1 : 33)).padStart(2, '0'));
  const sourceRef = options.sourceRef ?? 'a'.repeat(40);
  const controls = { child: readFileSync(new URL('child.mjs', ROOT)), probe: readFileSync(new URL('ci-domain-probe.mjs', ROOT)),
    stimulus: readFileSync(new URL('__fixtures__/ci-domain-stimulus-v2.json', ROOT)), oracle: readFileSync(new URL('__fixtures__/ci-domain-expectations-v2.json', ROOT)),
    collection: readFileSync(new URL('ci-domain-collection.mjs', ROOT)), parser: readFileSync(new URL('strict-json.mjs', ROOT)) };
  let source = options.sourceBytes ?? readFileSync(new URL('github.mjs', ROOT));
  if (!options.sourceBytes && options.sourceSha256 === '87a9210baf62c30dab3e3b83863a6b9399cafd6159755b239bbc80ffdd0e996d') source = oldLiteralReader(source);
  const sourceSha256 = options.sourceSha256 ?? sha(source), blob = createHash('sha1').update('blob ' + source.length + '\0').update(source).digest('hex');
  const f = syntheticNativeFixture(options.seed ?? sourceRef + ':' + batchId, batchId);
  const request = { adapter: 'engineering.ci-domains.v1', cases: caseIds.map(id => ({ id, text: JSON.stringify({ caseId: id }) })) };
  const output = options.outputBytes ?? bytes({ schema_version: 1, cases: caseIds.map(caseId => ({ schemaVersion: 1, caseId,
    observation: { provenanceKind: 'test-transport-untrusted', inProcessEvidenceClaim: false, globalProblems: [], ciStatus: 'BLOCKED',
      ciProblems: ['Synthetic metadata fixture only'], ciAssociation: null, actualCheckoutSha: null },
    wrapper: { executionComplete: true, setupErrors: [], requestCount: 0, membershipReadCount: 0, requests: [] } })) });
  const artifacts: Record<string, Buffer> = {};
  const put = (path: string, data: Buffer): ArtifactIdentity => { artifacts[path] = data; return { path, bytes: data.length, sha256: sha(data) }; };
  put('stdin.json', bytes(request)); put('collection-source.mjs.txt', controls.collection); put('parser-source.mjs.txt', controls.parser);
  put('child.mjs.txt', controls.child); put('ci-domain-probe.mjs.txt', controls.probe); put('ci-domain-stimulus-v2.json.txt', controls.stimulus);
  put('parent-expectations-v2.json.txt', controls.oracle);
  const exited = structuredClone(f.native); exited.State.Status = 'exited';
  const git = ['git', '--no-replace-objects'];
  const native = ['docker', 'container', 'inspect', f.identity.containerId];
  const mode = Buffer.from('100644 blob ' + blob + '\t' + SOURCE + '\n');
  const commands: [string, string[], Buffer][] = [
    ['subject-git-type', [...git, 'cat-file', '-t', sourceRef], Buffer.from('commit\n')],
    ['subject-git-mode', [...git, 'ls-tree', sourceRef, '--', SOURCE], mode],
    ['subject-git-bytes', [...git, 'cat-file', 'blob', blob], source],
    ['pre-name-absence', ['docker', 'container', 'ls', '--all', '--no-trunc', '--filter', 'name=^/' + f.identity.name + '$', '--format', '{{.ID}} {{.Names}}'], Buffer.alloc(0)],
    ['image-inspect', ['docker', 'image', 'inspect', READER_IMAGE], bytes([f.image])],
    ['builtin-none-inspect', ['docker', 'network', 'inspect', 'none'], bytes([f.builtin])],
    ['create', ['docker', 'create', '--interactive', '--pull=never', '--name', f.identity.name,
      '--label', OWNER + '=' + f.identity.owner, '--label', KIND + '=offline-reader-values', '--label', CASE + '=' + batchId,
      '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128',
      '--memory=768m', '--memory-swap=768m', '--cpus=1', '--user=65534:65534', '--tmpfs=/tmp:rw,noexec,nosuid,size=32m',
      '--workdir=/tmp', '--mount', 'type=bind,source=' + f.harness + ',target=/harness,readonly', READER_IMAGE, 'node', '/harness/child.mjs'], Buffer.from(f.identity.containerId + '\n')],
    ['inspect-prestart', native, bytes([f.native])],
    ['start-attach', ['docker', 'start', '--attach', '--interactive', f.identity.containerId], output],
    ['wait', ['docker', 'wait', f.identity.containerId], Buffer.from('0\n')],
    ['inspect-postexit', native, bytes([exited])],
    ['cleanup-owned-discovery', ['docker', 'container', 'ls', '--all', '--no-trunc', '--filter', 'label=' + OWNER + '=' + f.identity.owner, '--filter', 'name=^/' + f.identity.name + '$', '--format', '{{.ID}}'], Buffer.from(f.identity.containerId + '\n')],
    ['cleanup-owner-inspect', native, bytes([exited])],
    ['stop', ['docker', 'stop', '--time=1', f.identity.containerId], Buffer.from(f.identity.containerId + '\n')],
    ['cleanup-remove-owner-inspect', native, bytes([exited])],
    ['remove', ['docker', 'rm', '--force', f.identity.containerId], Buffer.from(f.identity.containerId + '\n')],
    ['absence-name', ['docker', 'container', 'ls', '--all', '--no-trunc', '--filter', 'name=^/' + f.identity.name + '$', '--format', '{{.ID}} {{.Names}}'], Buffer.alloc(0)],
    ['absence-owner', ['docker', 'container', 'ls', '--all', '--no-trunc', '--filter', 'label=' + OWNER + '=' + f.identity.owner, '--format', '{{.ID}}'], Buffer.alloc(0)],
    ['absence-id', ['docker', 'container', 'ls', '--all', '--no-trunc', '--filter', 'id=' + f.identity.containerId, '--format', '{{.ID}}'], Buffer.alloc(0)],
    ['subject-git-bookend', [...git, 'cat-file', 'blob', blob], source],
    ['subject-git-mode-bookend', [...git, 'ls-tree', sourceRef, '--', SOURCE], mode],
  ];
  put('intent.json', bytes({ argv: commands.find(([label]) => label === 'create')![1], sourceRef, expectedSourceSha256: sourceSha256,
    batchId, caseIds, image: READER_IMAGE, childSha256: options.childSha256 ?? sha(controls.child), probeSha256: sha(controls.probe),
    stimulusSha256: sha(controls.stimulus), parentOracleSha256: sha(controls.oracle), parentOracleMounted: false,
    collectionSha256: options.collectionSha256 ?? sha(controls.collection), parserSha256: options.parserSha256 ?? sha(controls.parser),
    registered: false, currentCodeVerified: false }));
  const processes: CaptureRecord[] = commands.map(([label, argv, raw], index) => {
    const process: CaptureRecord = { label, argv, phase: index < 11 ? 'work' : 'cleanup', startedOffsetMs: index * 10,
      absoluteDeadlineOffsetMs: index < 11 ? 26000 : 44000, inputBytes: label === 'start-attach' ? bytes(request).length : 0,
      status: 0, signal: null, pid: 12345 + index, processReaped: true, endedOffsetMs: index * 10 + 1, milliseconds: 1,
      timeout: false, overflow: false, interrupted: false, spawnError: null, ioErrors: [], streamsComplete: true,
      processGroupAbsent: true, processGroupProbeError: null, processGroupCleanupRequired: false,
      processGroupProbes: [{ offsetMs: index * 10 + 0.5, absent: true, error: null }],
      inputBytesWritten: label === 'start-attach' ? bytes(request).length : 0, inputComplete: true,
      stdout: { ...put(label + '.stdout.bin', raw), retained: true }, stderr: { ...put(label + '.stderr.bin', Buffer.alloc(0)), retained: true } };
    put(label + '.intent.json', bytes({ label, argv, phase: process.phase, startedOffsetMs: process.startedOffsetMs,
      absoluteDeadlineOffsetMs: process.absoluteDeadlineOffsetMs, inputBytes: process.inputBytes }));
    put(label + '.result.json', bytes(process)); return process;
  });
  const artifact = (path: string) => ({ path, bytes: artifacts[path].length, sha256: sha(artifacts[path]) });
  const inventory = Object.keys(artifacts).sort().map(artifact), retained = inventory.reduce((sum, row) => sum + row.bytes, 0);
  const manifest: BatchManifest = { schemaVersion: 1, kind: 'CI_DOMAIN_NATIVE_BATCH_OBSERVATIONS', adapter: 'engineering.ci-domains.v1', batchId, caseIds,
    source: { commit: sourceRef, path: SOURCE, blob, sha256: sourceSha256, bytes: source.length },
    harness: { childSha256: options.childSha256 ?? sha(controls.child), probeSha256: sha(controls.probe), stimulusSha256: sha(controls.stimulus), parentOracleSha256: sha(controls.oracle),
      collectionSha256: options.collectionSha256 ?? sha(controls.collection), parserSha256: options.parserSha256 ?? sha(controls.parser), parentOracleMounted: false },
    input: artifact('stdin.json'), output: artifact('start-attach.stdout.bin'), stderr: artifact('start-attach.stderr.bin'), image: READER_IMAGE,
    nativeContainer: { name: f.identity.name, id: f.identity.containerId, owner: f.identity.owner, batchId },
    nativeConfigurationAdmitted: true, sourceBookendMatches: true, controlBookendMatches: true, cleanupVerified: true,
    cleanupObservations: { name: true, owner: true, id: true, harnessAbsent: true }, executionExitCode: 0,
    collectionStatus: 'COMPLETE_UNASSESSED', primaryErrors: [], cleanupErrors: [], interruptionSignals: [], processes,
    absoluteDeadlines: { workMs: 26000, cleanupEndMs: 44000, wholeMs: 45000 }, secondsBeforeFinalization: 0.25,
    registered: false, currentCodeVerified: false, limitations: ['Synthetic unit fixture only; no reader or Docker source process was executed.'],
    artifacts: inventory, aggregateAccounting: { capBytes: 2097152, retainedBeforeReceiptBytes: retained, receiptBytes: 0, totalRetainedBytes: retained,
      cumulativeWrittenIncludingRemovedHarnessBytes: retained, includesSourcesCollectorMetadataAndReceipt: true } };
  const removedHarness = controls.child.length + controls.probe.length + controls.stimulus.length + source.length;
  for (let attempt = 0; attempt < 16; attempt++) {
    const length = bytes(manifest).length;
    if (manifest.aggregateAccounting.receiptBytes === length) break;
    manifest.aggregateAccounting.receiptBytes = length; manifest.aggregateAccounting.totalRetainedBytes = retained + length;
    manifest.aggregateAccounting.cumulativeWrittenIncludingRemovedHarnessBytes = retained + length + removedHarness;
  }
  artifacts['receipt.json'] = bytes(manifest);
  return { manifest, artifacts, native: f, request };
}
