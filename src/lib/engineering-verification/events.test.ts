// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveWorkflowRun } from './events.mjs';
const sha='a'.repeat(40);
function api(marker='1048', head=sha, artifactAttempt=2, artifactKey='1048') {
  const responses: Record<string,unknown> = {
    '': {default_branch:'main'}, '/actions/workflows/engineering-verification.yml':{id:7,path:'.github/workflows/engineering-verification.yml'},
    '/actions/runs/8': {id:8,run_attempt:2,workflow_id:7,repository:{full_name:'Gilmore3088/FeeInsight.com'},event:'workflow_dispatch',head_branch:'main',status:'completed'},
    '/actions/runs/8/artifacts': {total_count:1,artifacts:[{name:'engineering-verification-2995-'+sha+'-'+artifactKey+'-attempt-'+artifactAttempt,expired:false,workflow_run:{id:8}}]},
    '/pulls/2995':{head:{sha:head},body:'<!-- engineering-contract: '+marker+' -->'},
  };
  return async (input: string | URL | Request) => Response.json(responses[new URL(String(input)).pathname.replace('/repos/Gilmore3088/FeeInsight.com','')]);
}
describe('proof completion PR association',()=>{
  it('resolves manual proof completion through actual run and artifact metadata',async()=>{
    expect(await resolveWorkflowRun({runId:8,token:'read-token',fetchImpl:api()})).toEqual({resolved:true,prNumber:2995,headSha:sha,contractKey:'1048',executionStatus:'HISTORICAL_ONLY'});
  });
  it('never substitutes a historical pilot or stale head for the PR contract',async()=>{
    expect((await resolveWorkflowRun({runId:8,token:'read-token',fetchImpl:api('2285')})).resolved).toBe(false);
    expect((await resolveWorkflowRun({runId:8,token:'read-token',fetchImpl:api('1048','b'.repeat(40))})).resolved).toBe(false);
    expect((await resolveWorkflowRun({runId:8,token:'read-token',fetchImpl:api('1048',sha,1)})).resolved).toBe(false);
  });
});


describe('same-issue explicit revision association', () => {
  it('resolves only the exact current artifact/marker pair and retains key/status', async () => {
    expect(await resolveWorkflowRun({ runId: 8, token: 'read-token', fetchImpl: api('1048-v3', sha, 2, '1048-v3') })).toEqual({ resolved: true, prNumber: 2995, headSha: sha, contractKey: '1048-v3', executionStatus: 'CURRENT' });
  });
  it('retains v2 as historical rather than silently selecting its successor', async () => {
    expect(await resolveWorkflowRun({ runId: 8, token: 'read-token', fetchImpl: api('1048-v2', sha, 2, '1048-v2') })).toEqual({ resolved: true, prNumber: 2995, headSha: sha, contractKey: '1048-v2', executionStatus: 'HISTORICAL_ONLY' });
  });
  it.each([['1048-v3', '1048'], ['1048', '1048-v3'], ['1048-v3', 'latest'], ['1048-v3', '1048-v4']])('never substitutes marker %s with artifact revision %s', async (marker, artifactKey) => {
    expect((await resolveWorkflowRun({ runId: 8, token: 'read-token', fetchImpl: api(marker, sha, 2, artifactKey) })).resolved).toBe(false);
  });
  it.each(['', '1048-v3 -->\n<!-- engineering-contract: 1048-v3', '1048-v3 -->\n<!-- engineering-contract: 1048', 'latest'])('does not associate ambiguous/unknown marker %s', async marker => {
    expect((await resolveWorkflowRun({ runId: 8, token: 'read-token', fetchImpl: api(marker, sha, 2, '1048-v3') })).resolved).toBe(false);
  });
});
