import { beforeEach, describe, expect, it, vi } from 'vitest';
const { user, read } = vi.hoisted(() => ({ user: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: user }));
vi.mock('@/lib/api-hardening/route-wrapper', () => ({ withApiRoutePolicy: (_id: string, _method: string, handler: unknown) => handler }));
vi.mock('@/lib/engineering-verification/runtime', async original => ({ ...await original<typeof import('@/lib/engineering-verification/runtime')>(), readEngineeringRuntimeEvidence: read }));
vi.mock('@/lib/agents/deming/fixed-cohort-history', () => ({ withCohortReadTimeout: (_db: unknown, work: (scope: unknown) => Promise<unknown>) => work(undefined) }));
vi.mock('@/lib/data-store/connection', () => ({ sql: vi.fn() }));
import { GET } from './route';
describe('admin engineering runtime evidence endpoint', () => {
  beforeEach(() => { vi.clearAllMocks(); user.mockResolvedValue({ id: 7, role: 'admin' }); read.mockResolvedValue({ schemaVersion: 1, problems: [], deming: [], bayes: [] }); });
  const url = () => `https://feeinsight.com/api/admin/engineering-verification?deployedSha=${'a'.repeat(40)}&since=2026-01-01&until=2026-01-02`;
  it.each([null, { id: 8, role: 'analyst' }])('requires an authenticated admin before reading data', async actor => {
    user.mockResolvedValue(actor);
    expect((await GET(new Request(url()))).status).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });
  it('validates bounds and target identity before a database read', async () => {
    expect((await GET(new Request('https://feeinsight.com/api/admin/engineering-verification'))).status).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });
  it('returns source evidence privately and represents missing reads as unavailable', async () => {
    const response = await GET(new Request(url()));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    read.mockResolvedValue({ problems: ['Deming ledger read unavailable'] });
    expect((await GET(new Request(url()))).status).toBe(503);
    read.mockRejectedValue(new Error('timeout with private database detail'));
    const unavailable = await GET(new Request(url()));
    expect(unavailable.status).toBe(503);
    expect(JSON.stringify(await unavailable.json())).not.toContain('private database detail');
  });
  it('passes the exact validated owning-execution scope to the bounded authenticated ledger read', async () => {
    const requiredExecution = { agentName: 'knox', stepKey: 'extract', strategy: 'extract.rules', strategyVersion: 186,
      affectedUnits: [{ institutionId: 1, sourceDocumentId: 101 }], outputWitness: 'knox-extraction-attempt-v1' };
    const target = new URL(url()); target.searchParams.set('requiredExecution', JSON.stringify(requiredExecution));
    expect((await GET(new Request(target))).status).toBe(200);
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ requiredExecution }), undefined);
  });
  it('rejects unknown output selectors before ledger access without reflecting private input', async () => {
    const target = new URL(url()); target.searchParams.set('requiredExecution', JSON.stringify({ outputSelector: 'private-scope-canary' }));
    const response = await GET(new Request(target));
    expect(response.status).toBe(400);
    expect(read).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain('private-scope-canary');
  });

});
