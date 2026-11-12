// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CURRENT_PROOF_INPUTS, FORBIDDEN_PROOF_INPUTS } from './proof-inputs.fixture';
import { resolveContractRevision } from './contract-registry.mjs';
import { validateRevisionContract } from './proof.mjs';
import { frozenIdentities } from './runner.mjs';
const directories: string[] = [];
const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');
function directory() { const root = mkdtempSync(join(tmpdir(), 'proof-closure-')); directories.push(root); return root; }
function fixture() {
  const root = directory(), contract = JSON.parse(readFileSync(new URL('../../../docs/project/acceptance/engineering/1048-v3.json', import.meta.url), 'utf8'));
  const files: Record<string, string> = Object.fromEntries(CURRENT_PROOF_INPUTS.map(path => [path, 'Independent synthetic input: ' + path]));
  for (const requirement of contract.requirements) for (const kind of ['test','fixture','adapter']) {
    const path = requirement[kind + '_path']; files[path] ??= 'Independent synthetic input: ' + path; requirement[kind + '_sha256'] = hash(files[path]);
  }
  contract.execution_files = CURRENT_PROOF_INPUTS.map(path => ({ path, sha256: hash(files[path]) }));
  for (const [path, raw] of Object.entries(files)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), raw); }
  return { root, contract };
}
afterEach(() => { for (const root of directories.splice(0)) rmSync(root, { recursive:true,force:true }); });
describe('CURRENT complete reviewed preparer declaration', () => {
  it('accepts a complete regular closure with all shadow/config inputs absent', () => {
    const f=fixture(); expect(validateRevisionContract(resolveContractRevision('1048-v3'),f.contract,JSON.stringify(f.contract))).toEqual({ok:true,errors:[]});
    expect(() => frozenIdentities(f.root,f.contract)).not.toThrow();
  });
  it.each(CURRENT_PROOF_INPUTS)('rejects missing declared mandatory input %s before trusting a source snapshot', path => {
    const f=fixture(); f.contract.execution_files=f.contract.execution_files.filter((row:{path:string})=>row.path!==path);
    const result=validateRevisionContract(resolveContractRevision('1048-v3'),f.contract,JSON.stringify(f.contract));
    expect(result.ok).toBe(false); expect(result.errors.join(' ')).toMatch(/required|mandatory|closure|input/i);
  });
  it.each(['src/lib/engineering-verification/cli.mjs','src/lib/engineering-verification/proof.mjs','src/lib/engineering-verification/events.mjs','package.json','package-lock.json'])('local trusted parent rejects omitted preparer input %s', path => {
    const f=fixture(); f.contract.execution_files=f.contract.execution_files.filter((row:{path:string})=>row.path!==path);
    expect(() => frozenIdentities(f.root,f.contract)).toThrow(/required|mandatory|closure|input/i);
  });
});
describe('local resolver and npm absence boundary', () => {
  const cases=FORBIDDEN_PROOF_INPUTS.flatMap(path=>['file','directory','symlink'].map(kind=>({path,kind})));
  it.each(cases)('rejects existing $kind at forbidden $path', ({path,kind}) => {
    const f=fixture(),target=join(f.root,path); mkdirSync(dirname(target),{recursive:true});
    if(kind==='file')writeFileSync(target,'Unapproved local override');
    if(kind==='directory')mkdirSync(target);
    if(kind==='symlink'){const outside=directory();writeFileSync(join(outside,'target'),'same contents do not authorize a link');symlinkSync(join(outside,'target'),target);}
    expect(() => frozenIdentities(f.root,f.contract)).toThrow(/forbidden|shadow|override|absence/i);
  });
});


describe('absence is an lstat boundary', () => {
  it.each(FORBIDDEN_PROOF_INPUTS)('rejects a dangling symlink at %s', path => {
    const f=fixture(),target=join(f.root,path);mkdirSync(dirname(target),{recursive:true});symlinkSync(join(f.root,'missing-target'),target);
    expect(() => frozenIdentities(f.root,f.contract)).toThrow(/forbidden|shadow|override|absence/i);
  });
  it('does not reinterpret ENOTDIR while checking an ancestor attribute path as proven absence', () => {
    const f=fixture();rmSync(join(f.root,'src/lib/agents'),{recursive:true,force:true});writeFileSync(join(f.root,'src/lib/agents'),'blocking parent file');
    expect(() => frozenIdentities(f.root,f.contract)).toThrow(/absence/);
  });
});
