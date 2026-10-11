/** Read-only repository inventory and PR intake checks. No merge/delete/ref-write code. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const field = (body, name) => {
  const text = (body ?? '').replace(/<!--[\s\S]*?-->/g, '');
  return text.match(new RegExp(`^${name}:\\s*(.+)$`, 'mi'))?.[1].trim() ?? '';
};
export const workItem = body => Number(field(body, 'Work item').match(/^#(\d+)$/)?.[1]) || null;
export const recent = (value, cutoff) => Boolean(value && Date.parse(value) >= Date.parse(cutoff));
export const sameRepo = (a, b) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
const shaOK = value => /^[a-f0-9]{40}$/i.test(value ?? '');
const md = value => String(value ?? '').replace(/[\r\n]/g, ' ').replaceAll('|', '\\|').replaceAll('`', "'").replaceAll('<', '&lt;');
const stamp = value => new Date(value).toISOString();

export function classifyBranch(branch, prs, facts, policy, cutoff, moved = false) {
  const related = prs.filter(p => sameRepo(p.head?.repo?.full_name, policy.repository) && p.head.ref === branch.name);
  const open = related.filter(p => p.state === 'open');
  const dependent = prs.filter(p => p.state === 'open' && p.base?.ref === branch.name && sameRepo(p.base?.repo?.full_name, policy.repository));
  const exactMerged = related.find(p => p.merged_at && p.base?.ref === policy.default_branch && p.head.sha === branch.commit.sha && facts.mergedCommits?.includes(p.merge_commit_sha));
  const dates = related.flatMap(p => [p.created_at, p.updated_at, p.closed_at, p.merged_at]).filter(Boolean);
  const observed = related.map(p => p.created_at).filter(Boolean).sort()[0] ?? null;
  const parked = related.some(p => policy.parked_prs.includes(p.number));
  const incorporated = facts.ancestor === true ? 'ancestor_of_main' : exactMerged ? 'exact_head_merged_pr' : facts.error ? 'unknown' : 'unique_history_needs_review';
  let disposition;
  if (branch.name === policy.default_branch || branch.protected || policy.protected_prefixes.some(p => branch.name.startsWith(p))) disposition = 'protected';
  else if (moved || facts.error) disposition = 'protected_unknown_or_moving';
  else if (parked) disposition = 'parked_preserve';
  else if (dependent.length) disposition = 'protected_dependency';
  else if (recent(facts.committed_at, cutoff) || dates.some(d => recent(d, cutoff))) disposition = 'protected_recent';
  else if (!observed || !Number.isFinite(Date.parse(observed))) disposition = 'protected_unknown_age';
  else if (open.length) disposition = 'review_open_pr';
  else if (incorporated === 'ancestor_of_main' || incorporated === 'exact_head_merged_pr') disposition = 'incorporated_candidate';
  else disposition = 'investigate_unique_work';
  return {
    name: branch.name, sha: branch.commit.sha, disposition, incorporation: incorporated,
    branch_created_at: null, earliest_associated_pr: observed,
    age_note: 'PR association is historical evidence, not a branch creation timestamp. Ref recreation cannot be ruled out.',
    committed_at: facts.committed_at ?? null, ahead: facts.ahead ?? null, behind: facts.behind ?? null,
    prs: related.map(p => p.number), open_prs: open.map(p => p.number), dependent_prs: dependent.map(p => p.number),
    merged_pr_evidence: exactMerged?.number ?? null, error: facts.error ?? null,
    automatic_delete_allowed: false,
  };
}

export function overlapPairs(prs, files) {
  const result = [];
  for (let i = 0; i < prs.length; i++) for (let j = i + 1; j < prs.length; j++) {
    const a = prs[i], b = prs[j];
    const other = new Set(files[b.number] ?? []);
    const shared = (files[a.number] ?? []).filter(f => other.has(f));
    const duplicate = workItem(a.body) && workItem(a.body) === workItem(b.body);
    if (shared.length || duplicate) result.push({ a: a.number, b: b.number, same_work_item: Boolean(duplicate), shared_files: [...new Set(shared)] });
  }
  return result;
}

export function guardProblems(pr, all, overlaps, policy) {
  if (Date.parse(pr.created_at) < Date.parse(policy.enforce_after)) return []; // grandfather existing work
  const problems = [];
  for (const name of ['Work item', 'Owner', 'Area', 'Scope', 'Duplicate search', 'Verification', 'Rollback', 'Overlap review']) {
    const value = field(pr.body, name);
    if (!value || /^(todo|tbd|\.\.\.|<[^>]+>)$/i.test(value)) problems.push(`Complete the '${name}:' intake field.`);
  }
  if (!workItem(pr.body)) problems.push('Work item must be one canonical local issue, for example Work item: #984.');
  const area = field(pr.body, 'Area').toLowerCase();
  if (!policy.areas.includes(area)) problems.push(`Area must be one of: ${policy.areas.join(', ')}.`);
  if (policy.parked_areas.includes(area)) problems.push(`${area} is parked by James; do not open another implementation.`);
  if (all.filter(p => p.state === 'open' && field(p.body, 'Area').toLowerCase() === area).length > policy.wip_per_area) problems.push(`Area '${area}' exceeds ${policy.wip_per_area} open implementation PRs. Finish/reconcile work first.`);
  for (const other of all) if (other.number !== pr.number && other.state === 'open' && workItem(pr.body) && workItem(other.body) === workItem(pr.body)) problems.push(`Work item already has open PR #${other.number}; reuse it instead of duplicating implementation.`);
  const acknowledged = new Set([...field(pr.body, 'Overlap review').matchAll(/#(\d+)/g)].map(m => Number(m[1])));
  for (const pair of overlaps.filter(o => o.a === pr.number || o.b === pr.number)) {
    const other = pair.a === pr.number ? pair.b : pair.a;
    if (pair.shared_files.length && !acknowledged.has(other)) problems.push(`Shares files with #${other}; reconcile and name #${other} plus the agreed boundary in Overlap review.`);
  }
  return [...new Set(problems)];
}

export function replaceReport(body, report) {
  const start = '<!-- backlog-report:start -->', end = '<!-- backlog-report:end -->';
  if ((body.split(start).length - 1) !== 1 || (body.split(end).length - 1) !== 1 || body.indexOf(end) < body.indexOf(start)) throw new Error('Dashboard markers missing/ambiguous; refusing to overwrite owner notes.');
  const result = body.slice(0, body.indexOf(start) + start.length) + '\n' + report + '\n' + body.slice(body.indexOf(end));
  if (result.length > 60000) throw new Error('Dashboard too large; refusing partial update.');
  return result;
}

export function csv(rows, columns) {
  const cell = v => { let s = Array.isArray(v) ? v.join(';') : String(v ?? ''); if (/^[=+@\-\t\r]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; };
  return [columns, ...rows.map(r => columns.map(k => r[k]))].map(r => r.map(cell).join(',')).join('\n') + '\n';
}

export function gitFacts(main, head, mergeShas = [], cwd = process.cwd()) {
  if (![main, head, ...mergeShas].every(shaOK)) return { error: 'Invalid or unavailable commit identity.' };
  const git = args => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  for (const sha of [main, head]) if (git(['cat-file', '-e', `${sha}^{commit}`]).status !== 0) return { error: 'Commit missing from local full-history checkout.' };
  const ancestor = git(['merge-base', '--is-ancestor', head, main]);
  const counts = git(['rev-list', '--left-right', '--count', `${main}...${head}`]);
  const date = git(['show', '-s', '--format=%cI', head]);
  if (![0, 1].includes(ancestor.status) || counts.status !== 0 || date.status !== 0) return { error: 'Git comparison failed; no retirement conclusion.' };
  const [behind, ahead] = counts.stdout.trim().split(/\s+/).map(Number);
  if (![behind, ahead].every(Number.isFinite) || !Number.isFinite(Date.parse(date.stdout.trim()))) return { error: 'Invalid Git comparison output.' };
  return { ancestor: ancestor.status === 0, ahead, behind, committed_at: date.stdout.trim(), mergedCommits: mergeShas.filter(s => git(['merge-base', '--is-ancestor', s, main]).status === 0) };
}

export class GitHub {
  constructor(repository, token) { this.repository = repository; this.token = token; }
  async request(route, options = {}) {
    if (!route.startsWith(`/repos/${this.repository}/`)) throw new Error('API request outside configured repository.');
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(`https://api.github.com${route}`, {
        ...options, signal: AbortSignal.timeout(30000),
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      });
      if (response.ok) return response.json();
      if ([429, 502, 503, 504].includes(response.status) && attempt < 2) { await new Promise(r => setTimeout(r, Math.min(60, Number(response.headers.get('retry-after')) || 2 ** attempt) * 1000)); continue; }
      throw new Error(`GitHub ${response.status} at ${route.split('?')[0]}; inventory is incomplete.`);
    }
  }
  async pages(route) {
    const rows = [];
    for (let page = 1; page <= 1000; page++) {
      const batch = await this.request(`${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw new Error('Expected paginated array, not partial API data.');
      rows.push(...batch);
      if (batch.length < 100) return rows;
    }
    throw new Error('Pagination limit reached; no complete-inventory claim.');
  }
}

async function changedFiles(api, prs) {
  const result = {};
  for (const pr of prs) {
    const detail = await api.request(`/repos/${api.repository}/pulls/${pr.number}`);
    const rows = await api.pages(`/repos/${api.repository}/pulls/${pr.number}/files`);
    if (rows.length !== detail.changed_files) throw new Error(`Incomplete changed-file list for #${pr.number}.`);
    if (detail.head.sha !== pr.head.sha) throw new Error(`#${pr.number} changed during inventory; rerun instead of using stale results.`);
    result[pr.number] = [...new Set(rows.flatMap(r => [r.filename, r.previous_filename].filter(Boolean)))];
  }
  return result;
}

export function renderSummary(report) {
  const counts = Object.entries(report.counts).map(([name, count]) => `- ${name}: **${count}**`).join('\n');
  const open = report.prs.filter(p => p.state === 'open').map(p => `| #${p.number} | ${md(p.title)} | ${p.review_scope} |`).join('\n');
  const overlaps = report.overlaps.map(o => `- #${o.a} / #${o.b}: ${o.same_work_item ? 'same work item; ' : ''}${o.shared_files.length} shared path(s).`).join('\n') || 'No shared paths or duplicate work-item IDs detected among the observed open PRs.';
  return `## Latest inventory\n\nMeasured: ${report.generated_at}. Cutoff: ${report.cutoff}. Main: \`${report.main_sha}\`.\n\n${counts}\n\nSnapshot consistency: ${report.snapshot_stable ? 'branch refs stable across this read' : '**refs changed; rerun before decisions**'}. This is inventory, not a full code/visual/security audit. Branch creation dates are unavailable. Candidates are NOT deletion approval. No merges, closures, branch writes or deletions were performed by this report.\n\n### Open PRs\n| PR | Purpose | Scope |\n|---|---|---|\n${open}\n\n### Potential duplicate work\nShared paths are coordination warnings, not proof that implementations are equivalent.\n\n${overlaps}\n\nFull branch and historical-PR evidence is in the **backlog-inventory** artifact for ${report.run_url ? `[this run](${report.run_url})` : 'this local run'}.\n`;
}

async function main() {
  const policy = JSON.parse(fs.readFileSync('.github/backlog-policy.json', 'utf8'));
  if (process.env.GITHUB_REPOSITORY && !sameRepo(process.env.GITHUB_REPOSITORY, policy.repository)) throw new Error('Repository differs from policy; refusing to operate.');
  const mode = process.argv[2];
  const api = new GitHub(policy.repository, process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
  const root = `/repos/${policy.repository}`;
  if (mode === 'publish') {
    if (!['schedule', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME) || process.env.GITHUB_REF !== `refs/heads/${policy.default_branch}`) throw new Error('Dashboard updates run only on trusted default-branch schedule/manual runs.');
    const report = JSON.parse(fs.readFileSync('backlog-output/report.json', 'utf8'));
    if (report.repository !== policy.repository) throw new Error('Report repository mismatch.');
    const issue = await api.request(`${root}/issues/${policy.dashboard_issue}`);
    const body = replaceReport(issue.body ?? '', renderSummary(report));
    // The sole write in this utility: update only the report section of one configured issue.
    await api.request(`${root}/issues/${policy.dashboard_issue}`, { method: 'PATCH', body: JSON.stringify({ body }) });
    return;
  }
  if (mode === 'guard') {
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const pr = event.pull_request;
    if (!pr) throw new Error('Expected pull_request event.');
    if (Date.parse(pr.created_at) < Date.parse(policy.enforce_after)) { console.log('Legacy PR: new intake requirements are advisory, not retroactive blockers.'); return; }
    const all = await api.pages(`${root}/pulls?state=open`);
    const files = await changedFiles(api, all);
    const pairs = overlapPairs(all, files);
    const current = all.find(p => p.number === pr.number);
    if (!current) throw new Error('PR is no longer open; refusing a stale intake decision.');
    const problems = guardProblems(current, all, pairs, policy);
    const item = workItem(current.body);
    if (item) {
      const issue = await api.request(`${root}/issues/${item}`);
      if (issue.pull_request || issue.state !== 'open') problems.push('Canonical work item must be an open issue, not another PR.');
    }
    const text = `# Backlog intake\n\n${problems.length ? problems.map(x => `- ${x}`).join('\n') : 'Intake fields and observed open-PR overlap checks passed. This is NOT code approval or an atomic work lock.'}\n`;
    console.log(text);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
    if (problems.length) process.exitCode = 1;
    return;
  }
  if (mode !== 'inventory') throw new Error('Use inventory, guard, or publish. There is no destructive mode.');
  if (spawnSync('git', ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).stdout.trim() !== 'false') throw new Error('Inventory requires a full-history checkout (fetch-depth: 0).');
  const now = new Date();
  const cutoff = process.env.BACKLOG_CUTOFF || new Date(now.getTime() - policy.protect_hours * 3600000).toISOString();
  if (!Number.isFinite(Date.parse(cutoff)) || Date.parse(cutoff) > now.getTime()) throw new Error('Invalid cutoff.');
  const before = await api.pages(`${root}/branches`);
  const mainBranch = before.find(b => b.name === policy.default_branch);
  if (!mainBranch) throw new Error('Default branch missing from complete branch listing.');
  const prs = await api.pages(`${root}/pulls?state=all&sort=created&direction=desc`);
  const open = prs.filter(p => p.state === 'open');
  const files = await changedFiles(api, open);
  const after = await api.pages(`${root}/branches`);
  const finalRefs = new Map(after.map(b => [b.name, b.commit.sha]));
  const allBranches = [...before, ...after.filter(b => !before.some(a => a.name === b.name))];
  const rows = allBranches.map(branch => {
    const merged = prs.filter(p => p.merged_at && p.head?.sha === branch.commit.sha && sameRepo(p.head?.repo?.full_name, policy.repository)).map(p => p.merge_commit_sha).filter(shaOK);
    const facts = gitFacts(mainBranch.commit.sha, branch.commit.sha, merged);
    return classifyBranch(branch, prs, facts, policy, cutoff, !before.some(b => b.name === branch.name) || finalRefs.get(branch.name) !== branch.commit.sha);
  });
  const snapshotStable = before.length === after.length && before.every(b => finalRefs.get(b.name) === b.commit.sha);
  const report = {
    repository: policy.repository, generated_at: now.toISOString(), cutoff: stamp(cutoff), main_sha: mainBranch.commit.sha,
    snapshot_stable: snapshotStable, branches: rows, counts: {}, overlaps: overlapPairs(open, files),
    run_url: process.env.GITHUB_RUN_ID ? `https://github.com/${policy.repository}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
    prs: prs.map(p => ({ number: p.number, title: p.title, state: p.state, draft: p.draft, created_at: p.created_at, updated_at: p.updated_at, merged_at: p.merged_at, closed_at: p.closed_at, head: p.head.ref, head_sha: p.head.sha, base: p.base.ref, work_item: workItem(p.body), area: field(p.body, 'Area'), review_scope: [p.created_at, p.updated_at].some(d => recent(d, cutoff)) ? 'protected_recent' : p.state === 'open' ? 'older_open_review' : p.merged_at ? 'merged_history' : 'closed_history' })),
  };
  for (const row of rows) report.counts[row.disposition] = (report.counts[row.disposition] ?? 0) + 1;
  report.counts.total_branches = rows.length;
  report.counts.total_prs = prs.length;
  report.counts.open_prs = open.length;
  report.counts.comparison_errors = rows.filter(r => r.error).length;
  fs.mkdirSync('backlog-output', { recursive: true });
  fs.writeFileSync('backlog-output/report.json', JSON.stringify(report, null, 2));
  const summary = renderSummary(report);
  const table = rows.map(r => `| ${md(r.name)} | ${r.sha} | ${r.disposition} | ${r.incorporation} | ${r.prs.map(n => '#' + n).join(', ')} |`).join('\n');
  fs.writeFileSync('backlog-output/report.md', summary + '\n## Every observed branch\n\n| Branch | Head | Disposition | Evidence | PRs |\n|---|---|---|---|---|\n' + table + '\n');
  fs.writeFileSync('backlog-output/branches.csv', csv(rows, ['name', 'sha', 'disposition', 'incorporation', 'branch_created_at', 'earliest_associated_pr', 'committed_at', 'ahead', 'behind', 'prs', 'open_prs', 'dependent_prs', 'merged_pr_evidence', 'error', 'automatic_delete_allowed']));
  fs.writeFileSync('backlog-output/prs.csv', csv(report.prs, ['number', 'title', 'state', 'draft', 'created_at', 'updated_at', 'merged_at', 'closed_at', 'head', 'head_sha', 'base', 'work_item', 'area', 'review_scope']));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
