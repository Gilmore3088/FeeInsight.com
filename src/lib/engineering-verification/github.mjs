import { createHash } from 'node:crypto';

/** Read-only GitHub evidence collector. Trust applies only within this process, never to imported JSON. */
const trustedFetch = globalThis.fetch;
const collected = new WeakSet();
const sha40 = /^[a-f0-9]{40}$/i;
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export const isGithubEvidence = value => value != null && collected.has(value) && value.provenance?.kind === 'authenticated-github-api';

export async function collectGithubEvidence({ repository, prNumber, token, requiredChecks = ['app-tests'], includeDeployments = true, now = new Date(), fetchImpl = trustedFetch }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error('Valid repository and positive PR number required');
  if (typeof token !== 'string' || !token.trim()) throw new Error('Authenticated GitHub read token required');
  if (!Array.isArray(requiredChecks) || requiredChecks.length === 0 || requiredChecks.some(name => typeof name !== 'string' || !name)) throw new Error('Required check inventory must be explicit');
  const testTransport = fetchImpl !== trustedFetch;
  const base = `https://api.github.com/repos/${repository}`;
  const problems = [];
  const get = async path => {
    const response = await fetchImpl(base + path, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`GitHub ${path.split('?')[0]} returned ${response.status}`);
    return response.json();
  };
  const pages = async (path, field) => {
    const rows = [];
    for (let page = 1; page <= 20; page++) {
      const payload = await get(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const items = field ? payload[field] : payload;
      if (!Array.isArray(items)) throw new Error(`Malformed GitHub collection: ${field ?? path}`);
      rows.push(...items);
      if (items.length < 100) return rows;
    }
    throw new Error(`GitHub pagination exceeded bounded inventory: ${path}`);
  };
  const capture = async (name, work, fallback = []) => {
    try { return await work(); } catch (error) { problems.push(`${name}: ${error.message}`); return fallback; }
  };
  const pr = await get(`/pulls/${prNumber}`);
  const headSha = pr.head?.sha;
  if (!sha40.test(headSha ?? '')) throw new Error('GitHub PR has no valid head SHA');
  const [files, reviews, comments, checks, workflow, deployments, threads] = await Promise.all([
    capture('changed files', () => pages(`/pulls/${prNumber}/files`)),
    capture('reviews', () => pages(`/pulls/${prNumber}/reviews`)),
    capture('approval comments', () => pages(`/issues/${prNumber}/comments`)),
    capture('check runs', () => pages(`/commits/${headSha}/check-runs?filter=latest`, 'check_runs')),
    capture('CI workflow', () => get('/actions/workflows/test.yml'), null),
    includeDeployments ? capture('deployments', () => pages('/deployments')) : Promise.resolve([]),
    capture('review threads', async () => {
      const [owner, name] = repository.split('/'); const result = []; let cursor = null;
      for (let page = 0; page < 20; page++) {
        const response = await fetchImpl('https://api.github.com/graphql', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20000), body: JSON.stringify({ query: 'query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$cursor){nodes{id isResolved isOutdated path line} pageInfo{hasNextPage endCursor}}}}}', variables: { owner, name, number: prNumber, cursor } }) });
        if (!response.ok) throw new Error(`GraphQL returned ${response.status}`);
        const payload = await response.json(); const connection = payload.data?.repository?.pullRequest?.reviewThreads;
        if (payload.errors || !Array.isArray(connection?.nodes) || typeof connection.pageInfo?.hasNextPage !== 'boolean') throw new Error('Review-thread inventory unavailable');
        result.push(...connection.nodes);
        if (!connection.pageInfo.hasNextPage) return result;
        cursor = connection.pageInfo.endCursor;
        if (!cursor) throw new Error('Review-thread cursor unavailable');
      }
      throw new Error('Review-thread pagination exceeded bounded inventory');
    }),
  ]);
  const runs = workflow ? await capture('CI runs', () => pages(`/actions/workflows/${workflow.id}/runs?head_sha=${headSha}`, 'workflow_runs')) : [];
  const run = runs.filter(row => row.workflow_id === workflow?.id && row.head_sha === headSha && row.event === 'pull_request' && row.pull_requests?.some(item => item.number === prNumber))
    .sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt)[0];
  const trustedWorkflow = await capture('trusted workflow identity', async () => {
    const repo = await get('');
    const branch = await get(`/commits/${encodeURIComponent(repo.default_branch)}`);
    const [trusted, candidate] = await Promise.all([get(`/contents/.github/workflows/test.yml?ref=${branch.sha}`), get(`/contents/.github/workflows/test.yml?ref=${headSha}`)]);
    const digest = item => { if (item.encoding !== 'base64' || typeof item.content !== 'string') throw new Error('Workflow source unavailable'); return createHash('sha256').update(Buffer.from(item.content, 'base64')).digest('hex'); };
    return { trustedSha: branch.sha, trustedDigest: digest(trusted), candidateDigest: digest(candidate) };
  }, null);
  const [jobs, artifacts] = run ? await Promise.all([
    capture('CI jobs', () => pages(`/actions/runs/${run.id}/jobs?filter=latest`, 'jobs')),
    capture('CI artifacts', () => pages(`/actions/runs/${run.id}/artifacts`, 'artifacts')),
  ]) : [[], []];
  const ciProblems = [];
  if (!trustedWorkflow || trustedWorkflow.trustedDigest !== trustedWorkflow.candidateDigest) ciProblems.push('CI workflow differs from trusted default-branch workflow or its identity is unavailable');
  if (run?.repository?.full_name !== repository) ciProblems.push('CI workflow run repository identity missing or mismatched');
  if (workflow?.path !== '.github/workflows/test.yml' || !run) ciProblems.push('Current-head test.yml workflow run unavailable');
  if (run?.status !== 'completed' || run?.conclusion !== 'success') ciProblems.push('Current-head CI workflow has not completed successfully');
  for (const name of requiredChecks) {
    const job = jobs.find(row => row.name === name);
    const check = checks.find(row => row.name === name && row.head_sha === headSha && row.app?.slug === 'github-actions' && row.details_url === job?.html_url);
    if (!job || job.status !== 'completed' || job.conclusion !== 'success' || !check || check.status !== 'completed' || check.conclusion !== 'success') ciProblems.push(`Required ${name} is not a successful check bound to the expected workflow job`);
  }
  const deploymentStatuses = await Promise.all(deployments.map(async deployment => ({ ...deployment, statuses: await capture(`deployment ${deployment.id} statuses`, () => pages(`/deployments/${deployment.id}/statuses`)) })));
  const current = await get(`/pulls/${prNumber}`);
  if (current.head?.sha !== headSha) problems.push('Pull request head changed while collecting evidence');
  const snapshot = freeze({ schemaVersion: 1, provenance: { kind: testTransport ? 'test-transport-untrusted' : 'authenticated-github-api' }, repository, prNumber, observedAt: now.toISOString(), pullRequest: { number: prNumber, headSha, body: typeof pr.body === 'string' ? pr.body : '', openedAt: pr.created_at ?? null, author: pr.user, mergeSha: pr.merge_commit_sha ?? null, merged: pr.merged === true, mergedAt: pr.merged_at ?? null, state: pr.state, draft: pr.draft === true, mergeable: current.mergeable, url: pr.html_url }, files, reviews, comments, threads, checks, deploymentsIncluded: includeDeployments, deployments: deploymentStatuses, ci: { status: ciProblems.length || problems.length ? 'BLOCKED' : 'PASSED', runId: run?.id ?? null, runAttempt: run?.run_attempt ?? null, workflowId: workflow?.id ?? null, runHeadSha: run?.head_sha ?? null, actualCheckoutSha: null, checkoutRef: run?.event === 'pull_request' ? 'pull_request_merge_or_explicit_ref' : 'unknown', trustedWorkflow, run, jobs, artifacts, problems: ciProblems }, problems });
  collected.add(snapshot);
  return snapshot;
}
