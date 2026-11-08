import { createHash } from 'node:crypto';

/** Native Git fixture metadata only; this is never evidence provenance. */
export const nativeBlobSha = (raw: string) => createHash('sha1').update(`blob ${Buffer.byteLength(raw)}\0`).update(raw).digest('hex');
const treeSha = (prefix: string) => createHash('sha1').update('fixture-tree:' + prefix).digest('hex');
export function nativeTreeResponse(path: string, files: Record<string, string>): unknown | undefined {
  if (/^\/git\/commits\/[a-f0-9]{40}$/.test(path)) return { sha: path.split('/').at(-1), tree: { sha: treeSha('') } };
  if (!path.startsWith('/git/trees/')) return undefined;
  const directories = new Set(['']);
  for (const file of Object.keys(files)) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
  }
  const prefix = [...directories].find(value => treeSha(value) === path.split('/').at(-1));
  if (prefix == null) return undefined;
  const entries = new Map<string, { path: string; mode: string; type: string; sha: string }>();
  const base = prefix ? prefix + '/' : '';
  for (const [file, raw] of Object.entries(files)) {
    if (!file.startsWith(base)) continue;
    const rest = file.slice(base.length), segment = rest.split('/')[0];
    if (rest.includes('/')) entries.set(segment, { path: segment, mode: '040000', type: 'tree', sha: treeSha(base + segment) });
    else entries.set(segment, { path: segment, mode: '100644', type: 'blob', sha: nativeBlobSha(raw) });
  }
  return { sha: treeSha(prefix), truncated: false, tree: [...entries.values()] };
}
