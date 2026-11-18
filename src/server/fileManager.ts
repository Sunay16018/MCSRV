import fs from 'fs';
import path from 'path';
import type { FileNode } from '../shared/types.ts';

const ROOT_DIR = path.resolve(process.cwd());
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '.aistudio']);

export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathTraversalError';
  }
}

export function resolveSafePath(relativePath: string): { absPath: string; relPath: string } {
  const cleaned = (relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const absPath = path.resolve(ROOT_DIR, cleaned);

  if (absPath !== ROOT_DIR && !absPath.startsWith(ROOT_DIR + path.sep)) {
    throw new PathTraversalError(`Blocked path traversal attempt: "${relativePath}"`);
  }

  const normalizedRel = path.relative(ROOT_DIR, absPath).replace(/\\/g, '/');
  return { absPath, relPath: normalizedRel };
}

export function buildFileTree(relDir = ''): FileNode[] {
  const { absPath } = resolveSafePath(relDir);
  if (!fs.existsSync(absPath)) return [];

  const entries = fs.readdirSync(absPath, { withFileTypes: true });
  const nodes: FileNode[] = [];

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const childRel = relDir ? `${relDir}/${entry.name}` : entry.name;
    const childAbs = path.join(absPath, entry.name);

    if (entry.isDirectory()) {
      const stat = fs.statSync(childAbs);
      nodes.push({
        name: entry.name,
        path: childRel,
        type: 'directory',
        modifiedAt: stat.mtimeMs,
        children: buildFileTree(childRel),
      });
    } else if (entry.isFile()) {
      const stat = fs.statSync(childAbs);
      nodes.push({
        name: entry.name,
        path: childRel,
        type: 'file',
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        extension: path.extname(entry.name).toLowerCase(),
      });
    }
  }

  // Sort directories first, then alphabetically
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function readSafeFile(relativePath: string): { path: string; content: string; size: number } {
  const { absPath, relPath } = resolveSafePath(relativePath);
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    throw new Error(`File not found: ${relPath}`);
  }
  const content = fs.readFileSync(absPath, 'utf-8');
  return { path: relPath, content, size: Buffer.byteLength(content, 'utf8') };
}

export function writeSafeFile(relativePath: string, content: string): { path: string; size: number } {
  const { absPath, relPath } = resolveSafePath(relativePath);
  const parent = path.dirname(absPath);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }
  fs.writeFileSync(absPath, content, 'utf-8');
  return { path: relPath, size: Buffer.byteLength(content, 'utf8') };
}

export function createSafeEntry(relativePath: string, type: 'file' | 'directory'): string {
  const { absPath, relPath } = resolveSafePath(relativePath);
  if (fs.existsSync(absPath)) {
    throw new Error(`Already exists: ${relPath}`);
  }
  if (type === 'directory') {
    fs.mkdirSync(absPath, { recursive: true });
  } else {
    const parent = path.dirname(absPath);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    fs.writeFileSync(absPath, '', 'utf-8');
  }
  return relPath;
}

export function renameSafeEntry(oldRelativePath: string, newRelativePath: string): string {
  const src = resolveSafePath(oldRelativePath);
  const dst = resolveSafePath(newRelativePath);
  if (!fs.existsSync(src.absPath)) throw new Error(`Source not found: ${src.relPath}`);
  if (fs.existsSync(dst.absPath)) throw new Error(`Destination already exists: ${dst.relPath}`);
  const dstParent = path.dirname(dst.absPath);
  if (!fs.existsSync(dstParent)) fs.mkdirSync(dstParent, { recursive: true });
  fs.renameSync(src.absPath, dst.absPath);
  return dst.relPath;
}

export function deleteSafeEntry(relativePath: string): void {
  const { absPath, relPath } = resolveSafePath(relativePath);
  if (!relPath) throw new PathTraversalError('Cannot delete root directory');
  if (!fs.existsSync(absPath)) throw new Error(`Path not found: ${relPath}`);
  fs.rmSync(absPath, { recursive: true, force: true });
}
