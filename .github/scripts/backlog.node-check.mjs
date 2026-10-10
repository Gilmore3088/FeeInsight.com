import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyBranch, overlapPairs, guardProblems, field, workItem, csv, gitFacts, replaceReport, GitHub } from './backlog.mjs';

const policy = { repository: 'owner/repo', default_branch: 'main', parked_prs: [9], protected_prefixes: ['rescue/'], areas: ['maintenance', 'outreach'], parked_areas: ['outreach'], enforce_after: '2026-10-09T18:00:00Z', wip_per_area: 3 };
const cutoff = '2026-10-09T18:04:00Z';
const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
const branch = { name: 'fix/old', commit: { sha: A }, protected: false };
const old = { number: 1, state: 'closed', created_at: '2026-10-08T10:00:00Z', updated_at: '2026-10-08T12:00:00Z', head: { ref: 'fix/old', sha: A, repo: { full_name: 'owner/repo' } }, base: { ref: 'main', repo: { full_name: 'owner/repo' } } };
const facts = { ancestor: true, committed_at: '2026-10-08T09:00:00Z', ahead: 0, behind: 2, mergedCommits: [B] };
const disposition = (b = branch, p = [old], f = facts, moving = false) => classifyBranch(b, p, f, policy, cutoff, moving).disposition;

test('ancestry with old PR evidence is a candidate, never approval', () => {
  const r = classifyBranch(branch, [old], facts, policy, cutoff);
  assert.equal(r.disposition, 'incorporated_candidate'); assert.equal(r.automatic_delete_allowed, false); assert.equal(r.branch_created_at, null);
});
test('no PR never means safe deletion or known branch age', () => assert.equal(disposition(branch, []), 'protected_unknown_age'));
test('main and protected branches are preserved', () => {
  assert.equal(disposition({ ...branch, name: 'main' }), 'protected');
  assert.equal(disposition({ ...branch, protected: true }), 'protected');
  assert.equal(disposition({ ...branch, name: 'rescue/one' }), 'protected');
});
test('old PR with recent activity is protected', () => assert.equal(disposition(branch, [{ ...old, updated_at: cutoff }]), 'protected_recent'));
test('recent head commit is protected even for an old PR', () => assert.equal(disposition(branch, [old], { ...facts, committed_at: cutoff }), 'protected_recent'));
test('open old PR goes to review, not retirement', () => assert.equal(disposition(branch, [{ ...old, state: 'open' }]), 'review_open_pr'));
test('parked work is preserved even after closing the PR', () => assert.equal(disposition(branch, [{ ...old, number: 9 }]), 'parked_preserve'));
test('stacked PR base protects a branch with no open head PR', () => assert.equal(disposition(branch, [old, { ...old, number: 2, state: 'open', head: { ...old.head, ref: 'fix/child' }, base: { ref: branch.name, repo: { full_name: policy.repository } } }]), 'protected_dependency'));
test('foreign fork with the same branch name is not age evidence', () => assert.equal(disposition(branch, [{ ...old, head: { ...old.head, repo: { full_name: 'other/repo' } } }]), 'protected_unknown_age'));
test('moving and unreadable refs are never candidates', () => {
  assert.equal(disposition(branch, [old], facts, true), 'protected_unknown_or_moving');
  assert.equal(disposition(branch, [old], { error: 'missing' }), 'protected_unknown_or_moving');
});
test('unique commits need review', () => assert.equal(disposition(branch, [old], { ...facts, ancestor: false, ahead: 2 }), 'investigate_unique_work'));
test('squash/rebase evidence requires exact current head and reachable merge commit', () => {
  const merged = { ...old, merged_at: old.updated_at, merge_commit_sha: B };
  assert.equal(disposition(branch, [merged], { ...facts, ancestor: false }), 'incorporated_candidate');
  assert.equal(disposition(branch, [{ ...merged, head: { ...old.head, sha: C } }], { ...facts, ancestor: false }), 'investigate_unique_work');
  assert.equal(disposition(branch, [merged], { ...facts, ancestor: false, mergedCommits: [] }), 'investigate_unique_work');
});
test('merged into a different target is not enough', () => assert.equal(disposition(branch, [{ ...old, merged_at: old.updated_at, merge_commit_sha: B, base: { ref: 'develop' } }], { ...facts, ancestor: false }), 'investigate_unique_work'));
test('metadata ignores hidden comments', () => {
  assert.equal(field('<!-- Owner: fake -->\nOwner: actual', 'Owner'), 'actual');
  assert.equal(workItem('Work item: #123'), 123); assert.equal(workItem('Work item: #123 and #124'), null);
});
const intake = (id = 10, item = 22) => ({ number: id, state: 'open', created_at: '2026-10-09T20:00:00Z', body: `Work item: #${item}\nOwner: one agent\nArea: maintenance\nScope: repository governance only\nDuplicate search: checked existing PRs and main\nVerification: node tests\nRollback: revert this commit\nOverlap review: none` });
test('complete unique intake passes', () => { const p = intake(); assert.deepEqual(guardProblems(p, [p], [], policy), []); });
test('old PRs are not blocked retroactively', () => assert.deepEqual(guardProblems({ ...intake(), created_at: old.created_at, body: '' }, [], [], policy), []));
test('new PR missing intake fails', () => assert.ok(guardProblems({ ...intake(), body: '' }, [], [], policy).length >= 8));
test('duplicate work IDs are blocked even without shared files', () => {
  const a = intake(), b = intake(11);
  assert.equal(overlapPairs([a, b], { 10: ['a'], 11: ['b'] })[0].same_work_item, true);
  assert.ok(guardProblems(a, [a, b], [], policy).some(x => x.includes('already has')));
});
test('shared paths require explicit coordination', () => {
  const a = intake(), b = intake(11, 23), pairs = overlapPairs([a, b], { 10: ['x', 'a'], 11: ['x'] });
  assert.ok(guardProblems(a, [a, b], pairs, policy).some(x => x.includes('Shares files')));
  assert.deepEqual(guardProblems({ ...a, body: a.body.replace('Overlap review: none', 'Overlap review: #11 — agreed disjoint sections') }, [a, b], pairs, policy), []);
});
test('outreach is blocked and per-area WIP is bounded', () => {
  const p = intake();
  assert.ok(guardProblems({ ...p, body: p.body.replace('maintenance', 'outreach') }, [], [], policy).some(x => x.includes('parked')));
  assert.ok(guardProblems(p, [p, intake(11, 23), intake(12, 24), intake(13, 25)], [], policy).some(x => x.includes('exceeds')));
});
test('report update preserves owner notes and fails on missing/duplicate markers', () => {
  assert.equal(replaceReport('before\n<!-- backlog-report:start -->old<!-- backlog-report:end -->\nafter', 'NEW'), 'before\n<!-- backlog-report:start -->\nNEW\n<!-- backlog-report:end -->\nafter');
  assert.throws(() => replaceReport('no markers', 'x'));
  assert.throws(() => replaceReport('<!-- backlog-report:start --><!-- backlog-report:start --><!-- backlog-report:end -->', 'x'));
});
test('CSV quotes values and neutralizes spreadsheet formulas', () => {
  const result = csv([{ name: '=SUM(A1)', title: 'a,"b"' }], ['name', 'title']);
  assert.ok(result.includes("'=SUM(A1)")); assert.ok(result.includes('a,""b""'));
});
test('pagination continues until terminal page', async () => {
  const api = new GitHub('owner/repo'); const calls = [];
  api.request = async route => { calls.push(route); return calls.length === 1 ? Array(100).fill({}) : [{ number: 101 }]; };
  assert.equal((await api.pages('/repos/owner/repo/pulls?state=all')).length, 101); assert.ok(calls[1].includes('page=2'));
});
test('pagination errors are not turned into partial success', async () => {
  const api = new GitHub('owner/repo'); api.request = async () => ({ partial: [] });
  await assert.rejects(api.pages('/repos/owner/repo/branches'));
});
test('Git comparison validates SHA inputs and missing commits', () => {
  assert.ok(gitFacts('--bad', A).error); assert.ok(gitFacts(A, B, [], os.tmpdir()).error);
});
test('real Git fixture distinguishes merged ancestry from unique commits', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-git-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    fs.writeFileSync(path.join(dir, 'file'), 'base'); git('add', 'file'); git('commit', '-m', 'base'); const base = git('rev-parse', 'HEAD');
    git('checkout', '-b', 'feature'); fs.appendFileSync(path.join(dir, 'file'), '\nfeature'); git('commit', '-am', 'feature'); const feature = git('rev-parse', 'HEAD');
    assert.equal(gitFacts(base, feature, [], dir).ancestor, false); assert.equal(gitFacts(base, feature, [], dir).ahead, 1);
    git('checkout', 'main'); git('merge', '--no-ff', 'feature', '-m', 'merge'); const merged = git('rev-parse', 'HEAD');
    assert.equal(gitFacts(merged, feature, [], dir).ancestor, true); assert.equal(gitFacts(merged, feature, [], dir).ahead, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
