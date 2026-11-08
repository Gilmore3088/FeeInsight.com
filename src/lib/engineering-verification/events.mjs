/** Resolve an unprivileged workflow completion to an explicit, current PR contract. */
export async function resolveWorkflowRun({ runId, token, fetchImpl = fetch }) {
  if (!Number.isSafeInteger(runId) || runId < 1 || !token) throw new Error('Authenticated numeric workflow run required');
  const base = 'https://api.github.com/repos/Gilmore3088/FeeInsight.com';
  const get = async path => {
    const response = await fetchImpl(base + path, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('Workflow metadata read failed: ' + response.status);
    return response.json();
  };
  const [run, workflow, repo] = await Promise.all([get('/actions/runs/' + runId), get('/actions/workflows/engineering-verification.yml'), get('')]);
  if (run.repository?.full_name !== 'Gilmore3088/FeeInsight.com' || run.workflow_id !== workflow.id || workflow.path !== '.github/workflows/engineering-verification.yml'
    || run.event !== 'workflow_dispatch' || run.head_branch !== repo.default_branch || run.status !== 'completed') return { resolved: false, reason: 'Not a completed trusted proof workflow' };
  const payload = await get('/actions/runs/' + runId + '/artifacts?per_page=100');
  if (!Array.isArray(payload.artifacts) || payload.total_count > 100) throw new Error('Incomplete proof artifact inventory');
  const candidates = payload.artifacts.map(artifact => {
    const match = artifact.name?.match(/^engineering-verification-([1-9][0-9]*)-([a-f0-9]{40})-([1-9][0-9]*)-attempt-([1-9][0-9]*)$/);
    return match && Number(match[4]) === run.run_attempt && !artifact.expired && (!artifact.workflow_run || artifact.workflow_run.id === runId)
      ? { prNumber: Number(match[1]), headSha: match[2], contractNumber: match[3] } : null;
  }).filter(Boolean);
  const unique = [...new Map(candidates.map(item => [item.prNumber + ':' + item.headSha + ':' + item.contractNumber, item])).values()];
  if (unique.length !== 1) return { resolved: false, reason: 'No unique current proof artifact' };
  const candidate = unique[0];
  const pr = await get('/pulls/' + candidate.prNumber);
  const declared = pr.body?.match(/<!--\s*engineering-contract:\s*([1-9][0-9]*)\s*-->/)?.[1];
  if (pr.head?.sha !== candidate.headSha || declared !== candidate.contractNumber) return { resolved: false, reason: 'Artifact is stale or belongs to a different PR acceptance contract' };
  return { resolved: true, ...candidate };
}
