/** Add persistent protection, a 12-hour review queue, and evidence to #987's inventory.
 * No application imports/execution, remote ref writes, merges, closures or deletions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const shaOK = s => /^[a-f0-9]{40}$/.test(s ?? '');
const escape = s => String(s ?? '').replace(/[\r\n|]/g, ' ').replaceAll('<', '&lt;');
const isHeld = s => s?.startsWith('protected') || s === 'parked_preserve';
const stateMarker = /<!-- backlog-held-state:([^]*?) -->/g;

export function readHolds(body = '') {
  const matches = [...body.matchAll(stateMarker)];
  if (!matches.length) return {};
  if (matches.length !== 1) throw new Error('Ambiguous protection state; refusing release by omission.');
  const result = JSON.parse(matches[0][1]);
  if (!result || Array.isArray(result) || typeof result !== 'object' || Object.values(result).some(v => typeof v !== 'string' || !isHeld(v))) throw new Error('Invalid protection state.');
  return result;
}
export function writeHolds(body, holds) {
  readHolds(body); // reject duplicate/invalid state before replacing it
  const marker = `<!-- backlog-held-state:${JSON.stringify(holds)} -->`;
  return [...body.matchAll(stateMarker)].length ? body.replace(stateMarker, () => marker) : body + '\n\n' + marker;
}
export function replaceAgeSection(body, content) {
  const start = '<!-- backlog-age-review:start -->', end = '<!-- backlog-age-review:end -->';
  const a = body.split(start).length - 1, b = body.split(end).length - 1;
  if (a === 0 && b === 0) return body + `\n\n${start}\n${content}\n${end}`;
  if (a !== 1 || b !== 1 || body.indexOf(end) < body.indexOf(start)) throw new Error('Ambiguous age-review markers.');
  return body.slice(0, body.indexOf(start) + start.length) + '\n' + content + '\n' + body.slice(body.indexOf(end));
}
export function applyHolds(branches, baseline, previous = {}) {
  const holds = Object.assign(Object.create(null), baseline, previous);
  for (const b of branches) if (isHeld(b.disposition)) holds[b.name] ??= b.disposition;
  return { holds, branches: branches.map(b => Object.hasOwn(holds, b.name) ? { ...b, observed_disposition: b.disposition, disposition: holds[b.name], protection_persistent: true, automatic_delete_allowed: false } : b) };
}
export function reviewQueue(prs, now, holds, hours = 12) {
  const time = Date.parse(now);
  if (!Number.isFinite(time)) throw new Error('Invalid review timestamp.');
  return prs.filter(p => p.state === 'open').map(p => {
    const age = (time - Date.parse(p.created_at)) / 3600000;
    return { number: p.number, head_sha: p.head_sha, title: p.title, owner: p.owner || 'Coordinator to confirm existing implementer', age_hours: Number.isFinite(age) && age >= 0 ? Math.floor(age * 10) / 10 : null,
      review_due: !Number.isFinite(age) || age < 0 || age >= hours, protected: Object.hasOwn(holds, p.head),
      next_action: Object.hasOwn(holds, p.head) ? 'Owner check-in only; active/protected work stays untouched' : p.draft ? 'Coordinator: identify missing evidence and one next action' : 'Coordinator: review evidence and recommend disposition; no automatic merge',
      review_only: true, automatic_close_allowed: false };
  }).filter(p => p.review_due).sort((a, b) => (b.age_hours ?? Infinity) - (a.age_hours ?? Infinity));
}
export function candidateDecision(expected, row, stable, recoveryCovered) {
  const reasons = [];
  if (!row) reasons.push('branch_missing');
  else {
    if (row.sha !== expected[1]) reasons.push('head_changed');
    if (row.disposition !== 'incorporated_candidate') reasons.push('not_an_unprotected_candidate');
    if (row.incorporation !== 'ancestor_of_main' || row.ahead !== 0 || row.error) reasons.push('direct_ancestry_not_verified');
    if (row.open_prs?.length || row.dependent_prs?.length) reasons.push('open_or_dependent_pr');
  }
  if (!stable) reasons.push('snapshot_changed');
  if (!recoveryCovered) reasons.push('recovery_not_verified');
  return { branch: expected[0], expected_sha: expected[1], current_sha: row?.sha ?? null, status: reasons.length ? 'SKIP' : 'PROPOSE_REMOVAL', reasons, approval: 'NOT_APPROVED', automatic_delete_allowed: false };
}
function git(args, cwd = process.cwd()) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`Git evidence failed: ${args[0]}`);
  return r.stdout;
}
function ancestor(a, b) {
  if (!shaOK(a) || !shaOK(b)) return false;
  return spawnSync('git', ['merge-base', '--is-ancestor', a, b], { stdio: 'ignore' }).status === 0;
}
function evidence(branch, main, dir) {
  if (!shaOK(branch.sha) || !shaOK(main)) throw new Error('Invalid evidence SHA.');
  const base = git(['merge-base', main, branch.sha]).trim();
  const prefix = path.join(dir, branch.name.replace(/[^a-zA-Z0-9._-]/g, '_'));
  const cherry = git(['cherry', main, branch.sha]).trim();
  const files = git(['diff', '--name-only', `${base}..${branch.sha}`]).trim().split('\n').filter(Boolean);
  fs.writeFileSync(prefix + '.patch', git(['diff', '--no-ext-diff', '--no-textconv', `${base}..${branch.sha}`]));
  fs.writeFileSync(prefix + '.log', git(['log', '--format=%H %s', `${main}..${branch.sha}`]));
  const equal = files.filter(f => spawnSync('git', ['diff', '--quiet', main, branch.sha, '--', f]).status === 0);
  const plus = cherry.split('\n').filter(x => x.startsWith('+ ')).length;
  const minus = cherry.split('\n').filter(x => x.startsWith('- ')).length;
  return { branch: branch.name, sha: branch.sha, merge_base: base, ahead: branch.ahead, behind: branch.behind, original_changed_files: files, files_identical_on_main: equal,
    patch_equivalent_commits: minus, unmatched_patch_commits: plus, cherry, prs: branch.prs,
    owner: 'Backlog coordinator (investigation only)', disposition: 'REVIEW_REQUIRED',
    next_action: 'Read actual patch and existing replacements; do not create another implementation',
    note: 'Patch IDs and equal files are evidence, not semantic or production verification.' };
}
export function summary(report) {
  const rows = report.review_due.map(p => `| #${p.number} | ${escape(p.title)} | ${p.age_hours ?? 'unknown'} | ${escape(p.next_action)} |`).join('\n');
  const overlaps = report.overlaps.map(o => `- #${o.a} / #${o.b}: ${o.shared_files.length} shared path(s); coordinate, do not assume duplicate code.`).join('\n') || 'No observed shared-path overlap.';
  const proposed = report.batch.filter(b => b.status === 'PROPOSE_REMOVAL').length;
  return `## Latest review queue\nMeasured ${report.generated_at}; main \`${report.main_sha}\`.\n\n${report.branches.length} branch records. ${Object.keys(report.held_state).length} persistent exclusions. ${report.review_due.length} open PRs at least 12 hours old (or with unknown age) require review. Age never releases protected work.\n\n| PR | Purpose | Hours since creation | Next action |\n|---|---|---|---|\n${rows}\n\nBatch 01: ${proposed}/${report.batch.length} exact-SHA candidates pass the evidence gates. **No deletion approval or execution.** Recovery: \`${report.recovery.ref}\` at \`${report.recovery.sha}\`.\n\n${report.investigations.filter(x => x.merge_base).length}/${report.investigations.length} branch investigations have patch/log evidence; this is not a claim they are resolved. ${report.redteam.filter(x => x.merge_base).length}/${report.redteam.length} red-team branches have implementation-difference evidence; no fixes are marked finished from names alone.\n\n### Coordination warnings\n${overlaps}\n\nEvidence: [run and backlog-inventory artifact](${report.run_url}). Bootstrap/CI reporting is not production verification.\n`;
}
async function main() {
  const policy = JSON.parse(fs.readFileSync('.github/backlog-policy.json', 'utf8'));
  const scope = JSON.parse(fs.readFileSync('.github/backlog-review-scope.json', 'utf8'));
  const { GitHub, replaceReport, csv } = await import('./backlog.mjs');
  if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY !== policy.repository) throw new Error('Wrong repository.');
  const api = new GitHub(policy.repository, process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
  const root = `/repos/${policy.repository}`;
  const issue = await api.request(`${root}/issues/${policy.dashboard_issue}`);
  const mode = process.argv[2];
  if (mode === 'age') {
    if (!['schedule', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME) || process.env.GITHUB_REF !== `refs/heads/${policy.default_branch}`) throw new Error('Age dashboard writes require a trusted main run.');
    const open = await api.pages(`${root}/pulls?state=open`);
    const holds = Object.assign(Object.create(null), scope.held, readHolds(issue.body));
    for (const p of open) if (Date.parse(p.created_at) >= Date.parse(policy.initial_cutoff)) holds[p.head.ref] ??= 'protected_recent';
    const now = new Date().toISOString();
    const rows = reviewQueue(open.map(p => ({ ...p, head: p.head.ref, head_sha: p.head.sha, owner: p.body?.match(/^Owner:\s*(.+)$/mi)?.[1] })), now, holds);
    const text = `## PRs awaiting a 12-hour review\nChecked ${now}. This is automatic triage, not an automated code review. Protected work receives an owner check-in only; no closure, merge or deletion is authorized.\n\n| PR | Head | Age (hours) | Next action |\n|---|---|---|---|\n` + rows.map(p => `| #${p.number} | ${p.head_sha.slice(0, 12)} | ${p.age_hours ?? 'unknown'} | ${escape(p.next_action)} |`).join('\n');
    // Refresh immediately before editing and preserve any newly added holds/owner notes.
    const latest = await api.request(`${root}/issues/${policy.dashboard_issue}`);
    Object.assign(holds, readHolds(latest.body));
    const body = writeHolds(replaceAgeSection(latest.body, text), holds);
    if (body.length > 60000) throw new Error('Dashboard too large; no truncation permitted.');
    await api.request(`${root}/issues/${policy.dashboard_issue}`, { method: 'PATCH', body: JSON.stringify({ body }) });
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
    console.log(text); return;
  }
  if (mode === 'publish') {
    if (!['schedule', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME) || process.env.GITHUB_REF !== `refs/heads/${policy.default_branch}`) throw new Error('Only trusted main scheduled/manual runs may update the dashboard.');
    const report = JSON.parse(fs.readFileSync('backlog-output/resolution-evidence.json', 'utf8'));
    if (report.repository !== policy.repository) throw new Error('Wrong report repository.');
    // Retain any protections recorded since the read. No owner notes outside markers change.
    Object.assign(report.held_state, readHolds(issue.body));
    await api.request(`${root}/issues/${policy.dashboard_issue}`, { method: 'PATCH', body: JSON.stringify({ body: writeHolds(replaceReport(issue.body, summary(report)), report.held_state) }) });
    return;
  }
  if (mode !== 'enrich') throw new Error('Use enrich, publish or age; no destructive mode exists.');
  const report = JSON.parse(fs.readFileSync('backlog-output/report.json', 'utf8'));
  if (report.repository !== policy.repository) throw new Error('Wrong report repository.');
  const applied = applyHolds(report.branches, scope.held, readHolds(issue.body));
  report.branches = applied.branches; report.held_state = applied.holds;
  const freshPrs = await api.pages(`${root}/pulls?state=open`);
  for (const p of report.prs.filter(p => p.state === 'open')) {
    const live = freshPrs.find(x => x.number === p.number);
    if (!live || live.head.sha !== p.head_sha) report.snapshot_stable = false;
    p.owner = live?.body?.match(/^Owner:\s*(.+)$/mi)?.[1] ?? 'Existing PR owner; coordinator confirms handoff';
  }
  if (freshPrs.some(p => !report.prs.some(x => x.number === p.number && x.state === 'open'))) report.snapshot_stable = false;
  report.review_due = reviewQueue(report.prs, report.generated_at, applied.holds, 12);
  const dir = 'backlog-output/branch-evidence'; fs.mkdirSync(dir, { recursive: true });
  report.investigations = scope.investigate.map(([name, sha]) => {
    const b = report.branches.find(r => r.name === name);
    if (!b || b.sha !== sha || isHeld(b.disposition)) return { branch: name, sha: b?.sha ?? null, disposition: 'PROTECT_CHANGED_OR_HELD', next_action: 'Preserve; confirm owner before investigation' };
    try { return evidence(b, report.main_sha, dir); } catch (e) { return { branch: name, sha, disposition: 'EVIDENCE_ERROR', error: e.message }; }
  });
  report.redteam = report.branches.filter(b => b.name.startsWith('redteam/')).map(b => {
    try { return { ...evidence(b, report.main_sha, dir), disposition: 'PROTECTED_NO_COMPLETION_CLAIM' }; } catch (e) { return { branch: b.name, disposition: 'EVIDENCE_ERROR', error: e.message }; }
  });
  const current = await api.pages(`${root}/branches`);
  const refs = new Map(current.map(b => [b.name, b.commit.sha]));
  if (current.length !== report.branches.length || report.branches.some(b => refs.get(b.name) !== b.sha)) report.snapshot_stable = false;
  const recoveryOK = refs.get(scope.recovery.ref) === scope.recovery.sha;
  report.recovery = { ...scope.recovery, remote_ref_verified: recoveryOK };
  report.batch = scope.candidates.map(expected => {
    const b = report.branches.find(x => x.name === expected[0]);
    const result = candidateDecision(expected, b, report.snapshot_stable, recoveryOK && ancestor(expected[1], scope.recovery.sha));
    return { ...result, incorporated_into: report.main_sha, incorporation: b?.incorporation, related_prs: b?.prs ?? [], recovery_ref: scope.recovery.ref, recovery_sha: scope.recovery.sha };
  });
  fs.writeFileSync('backlog-output/resolution-evidence.json', JSON.stringify(report, null, 2));
  fs.writeFileSync('backlog-output/review-queue.md', summary(report));
  fs.writeFileSync('backlog-output/batch-01.json', JSON.stringify(report.batch, null, 2));
  fs.writeFileSync('backlog-output/unique-work.json', JSON.stringify(report.investigations, null, 2));
  fs.writeFileSync('backlog-output/redteam-evidence.json', JSON.stringify(report.redteam, null, 2));
  fs.writeFileSync('backlog-output/batch-01.csv', csv(report.batch, ['branch', 'expected_sha', 'status', 'reasons', 'related_prs', 'incorporated_into', 'recovery_ref', 'recovery_sha', 'approval']));
  console.log(summary(report));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(report));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });
