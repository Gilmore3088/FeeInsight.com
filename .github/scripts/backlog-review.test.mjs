import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHolds, writeHolds, replaceAgeSection, applyHolds, reviewQueue, candidateDecision } from './backlog-review.mjs';
const now = '2026-10-10T00:00:00Z', A = 'a'.repeat(40), B = 'b'.repeat(40);
const pr = { number: 10, state: 'open', draft: true, title: 'Existing fix', created_at: '2026-10-09T12:00:00Z', head: 'fix/active', head_sha: A };
const row = { name: 'fix/old', sha: A, disposition: 'incorporated_candidate', incorporation: 'ancestor_of_main', ahead: 0, open_prs: [], dependent_prs: [] };
const expected = ['fix/old', A];
test('12-hour boundary enters review exactly at threshold', () => assert.equal(reviewQueue([pr], now, {})[0].age_hours, 12));
test('under 12 hours stays out', () => assert.deepEqual(reviewQueue([{ ...pr, created_at: '2026-10-09T12:00:01Z' }], now, {}), []));
test('closed PRs never enter open review queue', () => assert.deepEqual(reviewQueue([{ ...pr, state: 'closed' }], now, {}), []));
test('recent metadata activity does not reset age from creation', () => assert.equal(reviewQueue([{ ...pr, updated_at: now }], now, {}).length, 1));
test('active older PR receives owner check-in, never closure permission', () => {
 const r = reviewQueue([pr], now, { 'fix/active': 'protected_recent' })[0];
 assert.equal(r.protected, true); assert.equal(r.automatic_close_allowed, false); assert.match(r.next_action, /check-in only/);
});
test('bad or future creation timestamps are reviewed as unknown', () => {
 for (const date of ['bad', '2027-01-01T00:00:00Z']) { const r = reviewQueue([{ ...pr, created_at: date }], now, {})[0]; assert.equal(r.age_hours, null); }
 assert.throws(() => reviewQueue([pr], 'bad', {}));
});
test('all initial protection categories survive aging and new incorporation', () => {
 for (const category of ['protected_recent', 'protected_unknown_age', 'protected', 'parked_preserve']) {
  const r = applyHolds([row], { 'fix/old': category }).branches[0]; assert.equal(r.disposition, category); assert.equal(r.automatic_delete_allowed, false);
 }
});
test('new protections accumulate and existing holds are not dropped', () => {
 const r = applyHolds([{ ...row, disposition: 'protected_recent' }], { missing: 'parked_preserve' }, { previous: 'protected' });
 assert.equal(r.holds['fix/old'], 'protected_recent'); assert.equal(r.holds.missing, 'parked_preserve'); assert.equal(r.holds.previous, 'protected');
});
test('moving the head cannot release a held branch', () => assert.equal(applyHolds([{ ...row, sha: B }], { 'fix/old': 'protected_recent' }).branches[0].protection_persistent, true));
test('state reader preserves explicit protection and fails closed on malformed data', () => {
 assert.deepEqual(readHolds('plain text'), {});
 assert.deepEqual(readHolds('<!-- backlog-held-state:{"x":"protected"} -->'), { x: 'protected' });
 for (const text of ['<!-- backlog-held-state:bad -->', '<!-- backlog-held-state:[] -->', '<!-- backlog-held-state:{"x":"incorporated_candidate"} -->', '<!-- backlog-held-state:{} --><!-- backlog-held-state:{} -->']) assert.throws(() => readHolds(text));
});
test('verified candidate is proposed, never authorized', () => {
 const r = candidateDecision(expected, row, true, true); assert.equal(r.status, 'PROPOSE_REMOVAL'); assert.equal(r.approval, 'NOT_APPROVED'); assert.equal(r.automatic_delete_allowed, false);
});
test('changed or missing head is skipped', () => {
 assert.ok(candidateDecision(expected, { ...row, sha: B }, true, true).reasons.includes('head_changed'));
 assert.equal(candidateDecision(expected, null, true, true).status, 'SKIP');
});
test('protected and unique branches cannot join the batch', () => {
 for (const disposition of ['protected_recent', 'protected_unknown_age', 'protected', 'parked_preserve', 'investigate_unique_work']) assert.equal(candidateDecision(expected, { ...row, disposition }, true, true).status, 'SKIP');
});
test('squash inference alone is not used for first deletion batch', () => assert.equal(candidateDecision(expected, { ...row, incorporation: 'exact_head_merged_pr' }, true, true).status, 'SKIP'));
test('unique commits and comparison errors block proposal', () => {
 assert.equal(candidateDecision(expected, { ...row, ahead: 1 }, true, true).status, 'SKIP');
 assert.equal(candidateDecision(expected, { ...row, error: 'unknown' }, true, true).status, 'SKIP');
});
test('open or dependent PR blocks proposal', () => {
 for (const key of ['open_prs', 'dependent_prs']) assert.equal(candidateDecision(expected, { ...row, [key]: [55] }, true, true).status, 'SKIP');
});
test('moving snapshot or absent recovery blocks proposal', () => {
 assert.equal(candidateDecision(expected, row, false, true).status, 'SKIP'); assert.equal(candidateDecision(expected, row, true, false).status, 'SKIP');
});

test('hourly section is replaced without overwriting owner notes', () => {
 const first = replaceAgeSection('OWNER DECISIONS', 'one');
 const second = replaceAgeSection(first, 'two');
 assert.ok(second.startsWith('OWNER DECISIONS')); assert.ok(!second.includes('one'));
 assert.equal(second.split('<!-- backlog-age-review:start -->').length, 2);
});
test('malformed hourly section blocks writes', () => assert.throws(() => replaceAgeSection('<!-- backlog-age-review:start -->', 'x')));
test('one shared protection state survives both report sections', () => {
 let text = writeHolds('Report', { x: 'protected_recent' });
 text = writeHolds(replaceAgeSection(text, 'hourly'), { x: 'protected_recent', y: 'parked_preserve' });
 assert.deepEqual(readHolds(text), { x: 'protected_recent', y: 'parked_preserve' });
 assert.equal(text.split('<!-- backlog-held-state:').length, 2);
});
