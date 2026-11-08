/** Trusted Node 22 TypeScript loader; candidate configs and lifecycle scripts are never read. */
import { registerHooks, createRequire } from 'node:module';
import { readFileSync, statSync, realpathSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const codeRoot = realpathSync(process.env.CODE_ROOT);
const requireTool = createRequire(pathToFileURL(join(process.env.TOOLCHAIN_ROOT, 'package.json')));
const ts = requireTool('typescript');
const within = path => path === codeRoot || path.startsWith(codeRoot + sep);
function sourceFile(path) {
  for (const file of [path, path + '.ts', path + '.tsx', path + '.js', join(path, 'index.ts'), join(path, 'index.js')]) {
    try {
      if (!statSync(file).isFile()) continue;
      const actual = realpathSync(file);
      if (!within(actual)) throw new Error('Import escapes source snapshot');
      return pathToFileURL(actual).href;
    } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
  }
  throw new Error('Source import unavailable: ' + path);
}
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('@/')) return { url: sourceFile(join(codeRoot, 'src', specifier.slice(2))), shortCircuit: true };
    const parent = context.parentURL?.startsWith('file:') ? fileURLToPath(context.parentURL) : '';
    if (within(parent)) {
      if (specifier.startsWith('.')) return { url: sourceFile(resolve(dirname(parent), specifier)), shortCircuit: true };
      if (specifier.startsWith('/') || specifier.startsWith('file:')) return { url: sourceFile(specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier), shortCircuit: true };
      if (!specifier.startsWith('node:')) return { url: pathToFileURL(requireTool.resolve(specifier)).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('file:') && /\.tsx?$/.test(url) && within(fileURLToPath(url))) {
      return { format: 'module', source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
        fileName: fileURLToPath(url),
      }).outputText, shortCircuit: true };
    }
    return next(url, context);
  },
});
