/** Required DB groups only: validate local connection identity and actual Vitest JSON execution. */
import { constants, openSync, closeSync, fstatSync, readSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MAX_REPORT_BYTES = 16 * 1024 * 1024;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
const moment = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const safeFile = value => text(value) && !isAbsolute(value) && !/[\\\x00-\x20\x7f:]/.test(value)
  && value.split('/').every(part => part && part !== '.' && part !== '..') && /\.(test|spec)\.[cm]?[jt]sx?$/.test(value);
const result = (problems, extra = {}) => ({ ok: problems.length === 0, status: problems.length ? 'BLOCKED' : 'PASSED', ...extra, problems: [...new Set(problems)].slice(0, 20) });

export function assessDatabaseEnvironment(env) {
  const problems = [];
  const app = record(env) ? env.DATABASE_URL : null, fixture = record(env) ? env.E2E_DATABASE_URL : null;
  if (!text(app) || !text(fixture)) problems.push('Both database environment variables are required');
  if (app !== fixture) problems.push('Application and fixture database identities must match exactly');
  for (const value of [app, fixture]) {
    try {
      // postgres has its own multihost parser; disallow ambiguous raw authority
      // syntax instead of relying on WHATWG URL's last-@ interpretation.
      if (!text(value) || /[\x00-\x20\x7f]/.test(value) || !/^postgres(?:ql)?:\/\//.test(value)) throw new Error();
      const authority = value.slice(value.indexOf('://') + 3).split(/[/?#]/)[0];
      if ((authority.match(/@/g) ?? []).length > 1 || decodeURIComponent(authority.slice(authority.indexOf('@') + 1)).includes(',')) throw new Error();
      const url = new URL(value), database = decodeURIComponent(url.pathname.slice(1));
      decodeURIComponent(url.username); decodeURIComponent(url.password);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        || !database || /[\/\x00-\x1f\x7f]/.test(database) || url.search || url.hash
        || (url.port && !(Number(url.port) > 0 && Number(url.port) <= 65535))) throw new Error();
    } catch { problems.push('Database URLs must be valid loopback PostgreSQL connections without query overrides or fragments'); }
  }
  return result(problems);
}

export function assessRequiredDatabaseResults(report, requiredFiles, { cwd = process.cwd() } = {}) {
  const problems = [];
  if (!text(cwd)) return result(['A valid local working directory is required']);
  if (!Array.isArray(requiredFiles) || !requiredFiles.length || requiredFiles.length > 1000 || requiredFiles.some(file => !safeFile(file)) || new Set(requiredFiles).size !== requiredFiles.length) return result(['Required test inventory must contain unique safe repository test paths']);
  if (!record(report) || report.success !== true || !Array.isArray(report.testResults) || !report.testResults.length || report.testResults.length > 2000) return result(['Successful complete Vitest JSON report required']);
  const counters = ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests', 'numTotalTestSuites', 'numPassedTestSuites', 'numFailedTestSuites', 'numPendingTestSuites'];
  if (counters.some(key => !count(report[key])) || !moment(report.startTime)) problems.push('Vitest execution counters or start time are missing or malformed');
  if (report.numFailedTests !== 0 || report.numFailedTestSuites !== 0) problems.push('Vitest report contains failed tests or suites');
  if (report.numTotalTests !== report.numPassedTests + report.numFailedTests + report.numPendingTests + report.numTodoTests
    || report.numTotalTestSuites !== report.numPassedTestSuites + report.numFailedTestSuites + report.numPendingTestSuites) problems.push('Vitest execution counters do not reconcile');
  // Native Vitest counts every file as a suite, plus nested describe suites.
  if (report.numTotalTestSuites < report.testResults.length) problems.push('Vitest suite count is smaller than the file inventory');
  if (report.numPassedTestSuites < requiredFiles.length) problems.push('Vitest passing suite count cannot cover the required files');
  const byName = new Map(), observed = { passed: 0, failed: 0, pending: 0, todo: 0 };
  let totalAssertions = 0, requiredAssertions = 0;
  for (const file of report.testResults) {
    if (!record(file) || !text(file.name) || /[\x00-\x1f\x7f]/.test(file.name) || !['passed', 'failed'].includes(file.status)
      || !Array.isArray(file.assertionResults) || !moment(file.startTime) || !moment(file.endTime) || file.endTime < file.startTime) { problems.push('Vitest file result is missing or malformed'); continue; }
    if (file.status === 'failed') problems.push('Vitest report contains a failed file result');
    const name = resolve(cwd, file.name);
    byName.set(name, [...(byName.get(name) ?? []), file]);
    totalAssertions += file.assertionResults.length;
    if (totalAssertions > 100000) return result(['Vitest assertion inventory exceeds the bounded limit']);
    for (const assertion of file.assertionResults) {
      if (!record(assertion) || !text(assertion.title) || !text(assertion.fullName) || !['passed', 'failed', 'pending', 'skipped', 'todo', 'disabled'].includes(assertion.status)) { problems.push('Vitest assertion result is malformed or has unknown status'); continue; }
      observed[['pending', 'skipped', 'disabled'].includes(assertion.status) ? 'pending' : assertion.status]++;
    }
  }
  if (totalAssertions !== report.numTotalTests || observed.passed !== report.numPassedTests || observed.failed !== report.numFailedTests || observed.pending !== report.numPendingTests || observed.todo !== report.numTodoTests) problems.push('Vitest assertion results do not match execution counters');
  for (const [index, file] of requiredFiles.entries()) {
    const matches = byName.get(resolve(cwd, file)) ?? [];
    if (matches.length !== 1) { problems.push(`Required file ${index + 1} must occur exactly once`); continue; }
    const suite = matches[0];
    if (suite.status !== 'passed' || !suite.assertionResults.length || suite.message !== '') problems.push(`Required file ${index + 1} did not complete with nonempty passing assertions`);
    requiredAssertions += suite.assertionResults.length;
    for (const assertion of suite.assertionResults) {
      if (!record(assertion) || assertion.status !== 'passed' || !moment(assertion.duration)
        || !Array.isArray(assertion.failureMessages) || assertion.failureMessages.length) problems.push(`Required assertion in file ${index + 1} was not completely passed`);
    }
  }
  return result(problems, { requiredFiles: requiredFiles.length, requiredAssertions });
}

function readReport(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_REPORT_BYTES) throw new Error();
    const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_REPORT_BYTES + 1));
    let length = 0, bytes;
    while (length < buffer.length && (bytes = readSync(fd, buffer, length, buffer.length - length, null)) > 0) length += bytes;
    if (!length || length !== stat.size || length > MAX_REPORT_BYTES) throw new Error();
    return JSON.parse(buffer.subarray(0, length).toString('utf8'));
  } catch { throw new Error('Vitest JSON report is unavailable, malformed, incomplete or exceeds the size limit'); }
  finally { if (fd !== undefined) closeSync(fd); }
}

export function main(args = process.argv.slice(2), env = process.env) {
  let assessment;
  if (args.length === 1 && args[0] === 'check-env') assessment = assessDatabaseEnvironment(env);
  else if (args[0] === 'check-results' && args[1] === '--report' && text(args[2]) && args[3] === '--files' && args.length > 4) assessment = assessRequiredDatabaseResults(readReport(args[2]), args.slice(4));
  else throw new Error('Usage: check-env OR check-results --report PATH --files REQUIRED_TEST_FILES');
  return assessment;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const assessment = main();
    if (!assessment.ok) throw new Error(assessment.problems.join('; '));
    process.stdout.write('Required database test guard: PASSED\n');
  } catch (error) {
    process.stderr.write('BLOCKED: ' + (error instanceof Error ? error.message : 'Required database test guard failed') + '\n');
    process.exitCode = 1;
  }
}
