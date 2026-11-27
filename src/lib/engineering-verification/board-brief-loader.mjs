/** Finite draft loader. Candidate config, tests, module overrides and expected data are not inputs. */
import { registerHooks, createRequire } from 'node:module';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = realpathSync(process.env.CODE_ROOT);
const harness = realpathSync('/harness');
const phase = process.env.HAMILTON_PHASE;
if (!['component', 'pdf-render', 'pdf-parse'].includes(phase)) throw new Error('Unsupported immutable loader phase');
const tool = createRequire('/toolchain/package.json');
const ts = tool('typescript');
const within = (base, path) => path === base || path.startsWith(base + sep);
const source = path => {
  for (const candidate of [path, path + '.ts', path + '.tsx', path + '.js', path + '.mjs', join(path, 'index.ts'), join(path, 'index.js')]) {
    try {
      if (!statSync(candidate).isFile()) continue;
      const actual = realpathSync(candidate);
      if (!within(root, actual) || /(?:^|\/)(?:node_modules|engineering-verification)(?:\/|$)/.test(actual) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(actual)) throw new Error('Source import outside admitted closure');
      return pathToFileURL(actual).href;
    } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
  }
  throw new Error('Required production source module is missing');
};
const seams = new Map([
  ['next/link', 'export {Link as default} from "file:///harness/board-brief-seams.mjs";'],
  ['next/navigation', 'export {useRouter} from "file:///harness/board-brief-seams.mjs";'],
  ['src/app/pro/(hamilton)/reports/board-actions', 'export {saveBoardBrief,previewBoardBriefFindings} from "file:///harness/board-brief-seams.mjs";'],
  ['src/components/hamilton/basket/AddToReportButton', 'export {useReportBasket} from "file:///harness/board-brief-seams.mjs";'],
  ['src/components/hamilton/reports/ReportOutput', 'export {ReportOutput} from "file:///harness/board-brief-seams.mjs";'],
]);
registerHooks({
  resolve(specifier, context, next) {
    const parent = context.parentURL?.startsWith('file:') ? fileURLToPath(context.parentURL) : '';
    const fromSource = within(root, parent);
    if (fromSource) {
      if (phase === 'component') {
        let key = specifier;
        if (specifier.startsWith('@/')) key = 'src/' + specifier.slice(2);
        else if (specifier.startsWith('.')) key = resolve(dirname(parent), specifier).slice(root.length + 1).replace(/\.(?:tsx?|js)$/, '');
        if (seams.has(key)) return { url: 'hamilton-stub:' + encodeURIComponent(key), shortCircuit: true };
      }
      if (specifier.startsWith('@/')) return { url: source(join(root, 'src', specifier.slice(2))), shortCircuit: true };
      if (specifier.startsWith('.')) return { url: source(resolve(dirname(parent), specifier)), shortCircuit: true };
      if (specifier.startsWith('/') || specifier.startsWith('file:')) return { url: source(specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier), shortCircuit: true };
      if (specifier.startsWith('node:')) return next(specifier, context);
      if (specifier.includes(':')) throw new Error('Unsupported source import scheme');
      return { url: pathToFileURL(tool.resolve(specifier)).href, shortCircuit: true };
    }
    if (context.parentURL?.startsWith('hamilton-stub:')) {
      if (specifier !== 'file:///harness/board-brief-seams.mjs') throw new Error('Unsupported stub import');
      return next(specifier, context);
    }
    if (within(harness, parent) && !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('file:') && !specifier.startsWith('node:')) return { url: pathToFileURL(tool.resolve(specifier)).href, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('hamilton-stub:')) {
      const body = seams.get(decodeURIComponent(url.slice('hamilton-stub:'.length)));
      if (!body || phase !== 'component') throw new Error('Unsupported finite stub');
      return { format: 'module', source: body, shortCircuit: true };
    }
    if (url.startsWith('file:') && within(root, fileURLToPath(url)) && /\.[cm]?[jt]sx?$/.test(url)) return { format: 'module', source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: fileURLToPath(url) }).outputText, shortCircuit: true };
    return next(url, context);
  },
});
