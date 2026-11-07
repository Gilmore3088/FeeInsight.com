import { classifyPath, routeSkills } from './contract.mjs';
const escape = text => text.replace(/[.*+?^{}$()|[\]\\]/g, '\\$&');
function matches(pattern, path) {
  const expression = pattern.split('/').map(part => part === '**' ? '.*' : part.split('*').map(escape).join('[^/]*')).join('/');
  return new RegExp('^' + expression + '$').test(path);
}
/** Scope is evaluated from GitHub's complete diff, never the author's narrative. */
export function assessChangedScope(contract, paths) {
  const problems = [];
  if (!Array.isArray(paths) || !paths.length) return { status: 'BLOCKED', problems: ['Changed-path inventory missing'] };
  const associated = new Set([
    'docs/project/acceptance/engineering/' + String(contract.issue).replace('#', '') + '.json',
    ...(contract.execution_files ?? []).map(file => file.path),
    ...(contract.requirements ?? []).flatMap(req => [req.test_path, req.fixture_path, req.adapter_path]),
  ]);
  for (const path of paths) {
    if (classifyPath(path) !== 'R0' && !associated.has(path) && !(contract.scope ?? []).some(pattern => matches(pattern, path))) problems.push('Changed path outside reviewed scope: ' + path);
  }
  for (const skill of routeSkills(paths)) if (!contract.required_skills.includes(skill)) problems.push('Actual diff requires missing skill: ' + skill);
  return { status: problems.length ? 'BLOCKED' : 'SCOPED', problems };
}
