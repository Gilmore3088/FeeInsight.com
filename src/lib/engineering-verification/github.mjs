import { createHash } from 'node:crypto';

/** Read-only GitHub evidence collector. Trust applies only within this process, never to imported JSON. */
const trustedFetch = globalThis.fetch;
const collected = new WeakSet();
const sha40 = /^[a-f0-9]{40}$/i;
const isSha = value => typeof value === 'string' && sha40.test(value);
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const ref = value => typeof value === 'string' && value.length > 0 && value.length <= 255 && !/[\x00-\x20\x7f]/.test(value);
const date = value => typeof value === 'string' ? Date.parse(value) : NaN;
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
  const [files, reviews, comments, checks, workflow, deployments, threads, repositoryIdentity] = await Promise.all([
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
    capture('repository identity', () => get(''), null),
  ]);
  const runs = workflow ? await capture('CI runs', () => pages(`/actions/workflows/${workflow.id}/runs?head_sha=${headSha}`, 'workflow_runs')) : [];
  const historical = pr.merged === true && pr.state === 'closed';
  const directAssociation = row => Array.isArray(row?.pull_requests) && row.pull_requests.some(item => item?.number === prNumber);
  const emptyAssociation = row => Array.isArray(row?.pull_requests) && row.pull_requests.length === 0;
  const latestRun = rows => rows.filter(row => row?.workflow_id === workflow?.id && row.head_sha === headSha && row.event === 'pull_request'
      && (directAssociation(row) || (historical && emptyAssociation(row))))
    .sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt)[0];
  const run = latestRun(runs);
  const sameRepository = (value, expected) => positiveId(expected?.id) && value?.id === expected.id && value?.full_name === expected.full_name;
  const sameMergedPr = value => value?.number === prNumber && value.state === 'closed' && value.merged_at === pr.merged_at && value.merge_commit_sha === pr.merge_commit_sha
    && value.head?.sha === headSha && value.head?.ref === pr.head?.ref && sameRepository(value.head?.repo, pr.head?.repo)
    && value.base?.sha === pr.base?.sha && value.base?.ref === pr.base?.ref && sameRepository(value.base?.repo, pr.base?.repo);
  const matchesHistoricalAssociation = rows => Array.isArray(rows) && rows.length === 1 && sameMergedPr(rows[0]);
  const ciProblems = [];
  let validatedHistoricalContext = false;
  const historicalIdentity = run && !directAssociation(run) ? await capture('historical CI association', async () => {
    // This intentionally supports only a closed, merged, same-repository PR whose
    // final tree is byte-identical to the native merge tree. Actual CI checkout
    // identity stays unknown; neither this association nor the missing trigger
    // relationship can authorize an open PR.
    if (!historical || pr.number !== prNumber || !isSha(pr.merge_commit_sha) || !isSha(pr.base?.sha)
      || !Number.isFinite(date(pr.merged_at)) || date(pr.merged_at) > now.getTime()
      || repositoryIdentity?.full_name !== repository || !positiveId(repositoryIdentity?.id)
      || !sameRepository(pr.head?.repo, repositoryIdentity) || !sameRepository(pr.base?.repo, repositoryIdentity)
      || !ref(pr.head?.ref) || pr.base?.ref !== repositoryIdentity.default_branch) throw new Error('Merged PR repository/ref/merge identity is unavailable or mismatched');
    const [associations, head, merge] = await Promise.all([
      pages(`/commits/${headSha}/pulls`), get(`/git/commits/${headSha}`), get(`/git/commits/${pr.merge_commit_sha}`),
    ]);
    if (!matchesHistoricalAssociation(associations)) throw new Error('Native commit-to-PR association is missing, ambiguous or mismatched');
    if (head.sha !== headSha || merge.sha !== pr.merge_commit_sha || !isSha(head.tree?.sha) || !isSha(merge.tree?.sha)) throw new Error('Native head and merge commit trees are missing or not identical');
    validatedHistoricalContext = true;
    if (head.tree.sha !== merge.tree.sha) {
      ciProblems.push('Native head and merge commit trees are not identical');
      return null;
    }
    return { kind: 'historical_head_identity', prNumber, triggerPrNumber: null, headSha, mergeSha: pr.merge_commit_sha, treeSha: head.tree.sha };
  }, null) : null;
  const association = directAssociation(run) ? { kind: 'direct_pr', prNumber, triggerPrNumber: null, headSha } : historicalIdentity;
  const validHistoricalRun = row => historicalIdentity && emptyAssociation(row)
    && sameRepository(row.repository, repositoryIdentity) && sameRepository(row.head_repository, pr.head.repo)
    && row.head_branch === pr.head.ref && row.path === '.github/workflows/test.yml'
    && Number.isFinite(date(row.created_at)) && Number.isFinite(date(row.updated_at))
    && date(row.created_at) <= date(row.updated_at) && date(row.updated_at) <= date(pr.merged_at);
  const trustedWorkflow = await capture('trusted workflow identity', async () => {
    if (!ref(repositoryIdentity?.default_branch)) throw new Error('Default-branch identity is unavailable');
    const branch = await get(`/commits/${encodeURIComponent(repositoryIdentity.default_branch)}`);
    const [trusted, candidate] = await Promise.all([get(`/contents/.github/workflows/test.yml?ref=${branch.sha}`), get(`/contents/.github/workflows/test.yml?ref=${headSha}`)]);
    const digest = item => { if (item.encoding !== 'base64' || typeof item.content !== 'string') throw new Error('Workflow source unavailable'); return createHash('sha256').update(Buffer.from(item.content, 'base64')).digest('hex'); };
    return { trustedSha: branch.sha, trustedDigest: digest(trusted), candidateDigest: digest(candidate) };
  }, null);
  const validRunIdentity = Number.isSafeInteger(run?.id) && run.id > 0 && Number.isSafeInteger(run?.run_attempt) && run.run_attempt > 0;
  const [jobs, artifacts] = validRunIdentity ? await Promise.all([
    capture('CI jobs', () => pages(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs')),
    capture('CI artifacts', () => pages(`/actions/runs/${run.id}/artifacts`, 'artifacts')),
  ]) : [[], []];
  if (!association || (!directAssociation(run) && !validHistoricalRun(run))) ciProblems.push('CI PR association or corroborated historical head identity is unavailable');
  if (!trustedWorkflow || trustedWorkflow.trustedDigest !== trustedWorkflow.candidateDigest) ciProblems.push('CI workflow differs from trusted default-branch workflow or its identity is unavailable');
  if (run?.repository?.full_name !== repository) ciProblems.push('CI workflow run repository identity missing or mismatched');
  if (!validRunIdentity) ciProblems.push('CI workflow run or attempt identity missing');
  if (workflow?.path !== '.github/workflows/test.yml' || !run) ciProblems.push('Current-head test.yml workflow run unavailable');
  if (run?.status !== 'completed' || run?.conclusion !== 'success') ciProblems.push('Current-head CI workflow has not completed successfully');
  for (const name of requiredChecks) {
    const job = jobs.find(row => row.name === name);
    const check = checks.find(row => row.name === name && row.head_sha === headSha && row.app?.slug === 'github-actions' && row.details_url === job?.html_url);
    if (!job || job.run_id !== run?.id || job.run_attempt !== run?.run_attempt || job.head_sha !== headSha
      || job.status !== 'completed' || job.conclusion !== 'success' || !check || check.status !== 'completed' || check.conclusion !== 'success') ciProblems.push(`Required ${name} is not a successful check bound to the expected workflow job`);
    if (historicalIdentity && (check?.app?.id !== 15368 || !positiveId(run.check_suite_id) || check?.check_suite?.id !== run.check_suite_id
      || !Number.isFinite(date(job?.completed_at)) || date(job.completed_at) > date(pr.merged_at))) ciProblems.push(`Required ${name} historical check suite or completion identity is unavailable`);
  }
  const deploymentStatuses = await Promise.all(deployments.map(async deployment => ({ ...deployment, statuses: await capture(`deployment ${deployment.id} statuses`, () => pages(`/deployments/${deployment.id}/statuses`)) })));
  if (validRunIdentity) {
    const [currentRun, currentRuns] = await Promise.all([
      capture('current CI run', () => get(`/actions/runs/${run.id}`), null),
      capture('current CI selection', () => pages(`/actions/workflows/${workflow.id}/runs?head_sha=${headSha}`, 'workflow_runs')),
    ]);
    const selected = latestRun(currentRuns);
    if (!currentRun || currentRun.id !== run.id || currentRun.run_attempt !== run.run_attempt
      || currentRun.workflow_id !== workflow.id || currentRun.head_sha !== headSha || currentRun.event !== 'pull_request'
      || currentRun.repository?.full_name !== repository || (directAssociation(run) ? !directAssociation(currentRun) : !validHistoricalRun(currentRun))
      || currentRun.status !== 'completed' || currentRun.conclusion !== 'success'
      || selected?.id !== run.id || selected?.run_attempt !== run.run_attempt
      || (historicalIdentity && !validHistoricalRun(selected))
      || selected?.status !== 'completed' || selected?.conclusion !== 'success') ciProblems.push('CI run or attempt changed while collecting evidence');
  }
  if (validatedHistoricalContext) {
    const associations = await capture('current historical CI association', () => pages(`/commits/${headSha}/pulls`), null);
    if (!matchesHistoricalAssociation(associations)) {
      const problem = 'Historical native commit association changed or could not be rechecked while collecting evidence';
      problems.push(problem);
      ciProblems.push(problem);
    }
  }
  const current = await capture('current pull request identity', () => get(`/pulls/${prNumber}`), null);
  if (current?.head?.sha !== headSha) problems.push('Pull request head changed while collecting evidence');
  if (historical && (!sameMergedPr(current) || current?.merged !== true)) problems.push('Historical merged PR identity changed while collecting evidence');
  const snapshot = freeze({ schemaVersion: 1, provenance: { kind: testTransport ? 'test-transport-untrusted' : 'authenticated-github-api' }, repository, prNumber, observedAt: now.toISOString(), pullRequest: { number: prNumber, headSha, body: typeof pr.body === 'string' ? pr.body : '', openedAt: pr.created_at ?? null, author: pr.user, mergeSha: pr.merge_commit_sha ?? null, merged: pr.merged === true, mergedAt: pr.merged_at ?? null, state: pr.state, draft: pr.draft === true, mergeable: current?.mergeable, url: pr.html_url }, files, reviews, comments, threads, checks, deploymentsIncluded: includeDeployments, deployments: deploymentStatuses, ci: { status: ciProblems.length || problems.length ? 'BLOCKED' : 'PASSED', association, runId: run?.id ?? null, runAttempt: run?.run_attempt ?? null, workflowId: workflow?.id ?? null, runHeadSha: run?.head_sha ?? null, actualCheckoutSha: null, checkoutRef: run?.event === 'pull_request' ? 'pull_request_merge_or_explicit_ref' : 'unknown', trustedWorkflow, run, jobs, artifacts, problems: ciProblems }, problems });
  collected.add(snapshot);
  return snapshot;
}
