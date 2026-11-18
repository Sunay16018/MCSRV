import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  CornerLeftUp,
  FileCode2,
  FileJson,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import type { FileNode } from '../shared/types.ts';
import { CodeMirrorEditor } from './CodeMirrorEditor.tsx';
import { apiFetch } from '../hooks/useServerSocket.ts';

interface FilesViewProps {
  initialFilePath?: string | null;
  onClearInitialFile?: () => void;
  onToast: (level: 'success' | 'warn' | 'error', title: string, message: string) => void;
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatModified(ms?: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleString('en-GB', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function findDirectoryNodes(tree: FileNode[], dirPath: string): FileNode[] {
  if (!dirPath) return tree;
  const parts = dirPath.split('/').filter(Boolean);
  let current = tree;
  for (const part of parts) {
    const found = current.find((n) => n.type === 'directory' && n.name === part);
    if (!found || !found.children) return [];
    current = found.children;
  }
  return current;
}

function fileIcon(node: FileNode) {
  if (node.type === 'directory') {
    return <Folder className="w-4 h-4 text-amber-400 shrink-0" />;
  }
  if (node.extension === '.ts' || node.extension === '.tsx' || node.extension === '.js') {
    return <FileCode2 className="w-4 h-4 text-sky-400 shrink-0" />;
  }
  if (node.extension === '.json') {
    return <FileJson className="w-4 h-4 text-emerald-400 shrink-0" />;
  }
  return <FileText className="w-4 h-4 text-slate-400 shrink-0" />;
}

export function FilesView({ initialFilePath, onClearInitialFile, onToast }: FilesViewProps) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [currentDir, setCurrentDir] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [checkedPaths, setCheckedPaths] = useState<Set<string>>(new Set());

  // Editor state (null when browsing directories like Pterodactyl)
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [savedContent, setSavedContent] = useState<string>('');
  const [editorContent, setEditorContent] = useState<string>('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);

  // Inline create / rename / delete confirmation states (no window.prompt / window.confirm)
  const [creatingMode, setCreatingMode] = useState<'file' | 'directory' | null>(null);
  const [newEntryName, setNewEntryName] = useState('');
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState('');
  const [confirmDeletePaths, setConfirmDeletePaths] = useState<string[] | null>(null);

  const loadTree = useCallback(async () => {
    const res = await apiFetch('/api/files/tree');
    const data = await res.json();
    setTree(data.tree ?? []);
  }, []);

  const openFile = useCallback(
    async (filePath: string) => {
      setLoadingFile(true);
      setEditingPath(filePath);
      try {
        const res = await apiFetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to read file');
        setEditingPath(data.path);
        setSavedContent(data.content);
        setEditorContent(data.content);
      } catch (err) {
        onToast('error', 'Read Error', (err as Error).message);
        setEditingPath(null);
      } finally {
        setLoadingFile(false);
      }
    },
    [onToast]
  );

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  useEffect(() => {
    if (initialFilePath) {
      const idx = initialFilePath.lastIndexOf('/');
      setCurrentDir(idx >= 0 ? initialFilePath.slice(0, idx) : '');
      void openFile(initialFilePath);
    } else {
      setEditingPath(null);
    }
  }, [initialFilePath, openFile]);

  const isDirty = editorContent !== savedContent;

  const handleSave = useCallback(async () => {
    if (!editingPath || saving) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/files/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: editingPath, content: editorContent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save file');
      setSavedContent(editorContent);
      if (!data.hotReloadedPlugin) {
        onToast('success', 'File Saved', `Saved ${editingPath} (${data.size} bytes)`);
      }
      void loadTree();
    } catch (err) {
      onToast('error', 'Save Failed', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [editingPath, editorContent, saving, onToast, loadTree]);

  const closeEditor = () => {
    setEditingPath(null);
    setSavedContent('');
    setEditorContent('');
    onClearInitialFile?.();
  };

  const navigateToDir = (dir: string) => {
    setCurrentDir(dir);
    setCheckedPaths(new Set());
    setSearchQuery('');
    setConfirmDeletePaths(null);
    setRenamingPath(null);
  };

  const navigateUp = () => {
    if (!currentDir) return;
    const idx = currentDir.lastIndexOf('/');
    navigateToDir(idx >= 0 ? currentDir.slice(0, idx) : '');
  };

  const currentItems = useMemo(() => {
    const raw = findDirectoryNodes(tree, currentDir);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return raw;
    return raw.filter((n) => n.name.toLowerCase().includes(q));
  }, [tree, currentDir, searchQuery]);

  const toggleCheck = (itemPath: string) => {
    setCheckedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(itemPath)) next.delete(itemPath);
      else next.add(itemPath);
      return next;
    });
  };

  const allChecked = currentItems.length > 0 && currentItems.every((i) => checkedPaths.has(i.path));
  const toggleCheckAll = () => {
    if (allChecked) {
      setCheckedPaths(new Set());
    } else {
      setCheckedPaths(new Set(currentItems.map((i) => i.path)));
    }
  };

  const handleCreateEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creatingMode || !newEntryName.trim()) return;
    const targetName = newEntryName.trim().replace(/^\/+/, '');
    const fullRel = currentDir && !targetName.includes('/') ? `${currentDir}/${targetName}` : targetName;
    try {
      const res = await apiFetch('/api/files/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: fullRel, type: creatingMode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Create failed');
      setTree(data.tree ?? []);
      setCreatingMode(null);
      setNewEntryName('');
      onToast('success', 'Created', data.path);
      if (creatingMode === 'file') {
        await openFile(data.path);
      }
    } catch (err) {
      onToast('error', 'Create Failed', (err as Error).message);
    }
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingPath || !renameTarget.trim()) return;
    const cleaned = renameTarget.trim().replace(/^\/+/, '');
    const parentIdx = renamingPath.lastIndexOf('/');
    const parent = parentIdx >= 0 ? renamingPath.slice(0, parentIdx) : '';
    const nextPath = cleaned.includes('/') ? cleaned : parent ? `${parent}/${cleaned}` : cleaned;

    try {
      const res = await apiFetch('/api/files/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: renamingPath, newPath: nextPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Rename failed');
      setTree(data.tree ?? []);
      setRenamingPath(null);
      setCheckedPaths(new Set());
      onToast('success', 'Renamed', data.path);
    } catch (err) {
      onToast('error', 'Rename Failed', (err as Error).message);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!confirmDeletePaths || confirmDeletePaths.length === 0) return;
    try {
      let latestTree = tree;
      for (const target of confirmDeletePaths) {
        const res = await apiFetch('/api/files/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: target }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Delete failed for ${target}`);
        latestTree = data.tree ?? latestTree;
      }
      setTree(latestTree);
      setCheckedPaths(new Set());
      onToast('warn', 'Deleted', `Removed ${confirmDeletePaths.length} item(s).`);
      setConfirmDeletePaths(null);
    } catch (err) {
      onToast('error', 'Delete Failed', (err as Error).message);
    }
  };

  const pathSegments = currentDir ? currentDir.split('/').filter(Boolean) : [];

  // Full-panel CodeMirror 6 Editor view (Pterodactyl style when a file is clicked)
  if (editingPath !== null) {
    const fileParts = editingPath.split('/');
    return (
      <div className="flex flex-col h-[calc(100dvh-7rem)] sm:h-[calc(100dvh-8rem)] bg-[#111620] border border-slate-800/80 rounded-lg overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-3 sm:px-4 py-2.5 border-b border-slate-800/80 bg-[#0e131c]">
          <div className="flex items-center gap-2 min-w-0 text-xs">
            <button
              onClick={closeEditor}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors shrink-0 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Files</span>
            </button>

            <div className="flex items-center gap-1 min-w-0 font-mono truncate">
              <span className="hidden sm:inline text-slate-500">/home/container/</span>
              <span className="text-slate-100 truncate">{fileParts.join('/')}</span>
            </div>

            {isDirty && (
              <span className="text-amber-400 font-medium shrink-0">Unsaved</span>
            )}
            {editingPath.startsWith('plugins/') && (
              <span className="hidden md:inline text-emerald-400/90 shrink-0">· Auto Hot-Reload</span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-auto">
            <button
              onClick={() => openFile(editingPath)}
              disabled={loadingFile}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Revert</span>
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : 'Save'}</span>
              <span className="hidden sm:inline">(Ctrl+S)</span>
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 bg-[#0d1118]">
          {loadingFile ? (
            <div className="h-full flex items-center justify-center text-xs text-slate-400">
              Loading {editingPath}...
            </div>
          ) : (
            <CodeMirrorEditor
              value={editorContent}
              filename={editingPath}
              onChange={setEditorContent}
              onSave={handleSave}
            />
          )}
        </div>
      </div>
    );
  }

  // Pterodactyl-Style Directory Browser View
  return (
    <div className="space-y-4">
      {/* Top Action & Breadcrumb Header */}
      <div className="bg-[#111620] border border-slate-800/80 rounded-lg p-3 sm:p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Breadcrumbs */}
          <nav className="flex flex-wrap items-center gap-1 text-xs font-mono min-w-0">
            <button
              onClick={() => navigateToDir('')}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-[#0b0e14] border border-slate-800/80 text-slate-300 hover:text-emerald-300 hover:border-slate-700 cursor-pointer"
            >
              <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
              <span>/home/container</span>
            </button>
            {pathSegments.map((seg, idx) => {
              const target = pathSegments.slice(0, idx + 1).join('/');
              const isLast = idx === pathSegments.length - 1;
              return (
                <div key={target} className="flex items-center gap-1">
                  <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
                  <button
                    onClick={() => navigateToDir(target)}
                    className={`px-2 py-1 rounded border cursor-pointer ${
                      isLast
                        ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300'
                        : 'bg-[#0b0e14] border-slate-800/80 text-slate-300 hover:text-slate-100'
                    }`}
                  >
                    {seg}
                  </button>
                </div>
              );
            })}
          </nav>

          {/* Toolbar Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {checkedPaths.size > 0 && (
              <button
                onClick={() => setConfirmDeletePaths(Array.from(checkedPaths))}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-rose-950/70 hover:bg-rose-900/80 text-rose-200 border border-rose-800/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete ({checkedPaths.size})
              </button>
            )}
            <button
              onClick={() => {
                setCreatingMode('directory');
                setNewEntryName('');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5 text-amber-400" />
              <span>New Directory</span>
            </button>
            <button
              onClick={() => {
                setCreatingMode('file');
                setNewEntryName(currentDir === 'plugins' ? 'my_plugin.ts' : 'notes.txt');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FilePlus className="w-3.5 h-3.5" />
              <span>New File</span>
            </button>
            <button
              onClick={() => void loadTree()}
              title="Refresh Directory"
              className="p-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Directory Search Bar */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Filter ${currentDir || 'container'} entries...`}
            className="w-full pl-9 pr-3 py-2 text-xs bg-[#0b0e14] border border-slate-800 rounded-md text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Inline Action Forms */}
        {creatingMode && (
          <form onSubmit={handleCreateEntry} className="p-3 rounded-md border border-slate-700/80 bg-[#0b0e14] flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400 whitespace-nowrap">
              New {creatingMode === 'file' ? 'File' : 'Directory'} in /{currentDir || 'container'}:
            </span>
            <input
              type="text"
              value={newEntryName}
              onChange={(e) => setNewEntryName(e.target.value)}
              placeholder={creatingMode === 'file' ? 'plugin.ts' : 'folder_name'}
              autoFocus
              className="flex-1 min-w-44 px-2.5 py-1.5 text-xs font-mono bg-[#111620] border border-slate-700 rounded text-slate-100 focus:outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              className="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded cursor-pointer"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setCreatingMode(null)}
              className="px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              Cancel
            </button>
          </form>
        )}

        {renamingPath && (
          <form onSubmit={handleRenameSubmit} className="p-3 rounded-md border border-slate-700/80 bg-[#0b0e14] flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400 whitespace-nowrap">Rename {renamingPath}:</span>
            <input
              type="text"
              value={renameTarget}
              onChange={(e) => setRenameTarget(e.target.value)}
              autoFocus
              className="flex-1 min-w-44 px-2.5 py-1.5 text-xs font-mono bg-[#111620] border border-slate-700 rounded text-slate-100 focus:outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              className="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded cursor-pointer"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => setRenamingPath(null)}
              className="px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              Cancel
            </button>
          </form>
        )}

        {confirmDeletePaths && (
          <div className="p-3 rounded-md border border-rose-900/60 bg-rose-950/35 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-rose-200 font-mono break-all">
              Delete {confirmDeletePaths.join(', ')}?
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleDeleteConfirm}
                className="px-3 py-1.5 text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white rounded cursor-pointer"
              >
                Confirm Delete
              </button>
              <button
                onClick={() => setConfirmDeletePaths(null)}
                className="px-2.5 py-1.5 text-xs text-slate-300 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Directory Table (Pterodactyl Hosting Panel Layout) */}
      <div className="bg-[#111620] border border-slate-800/80 rounded-lg overflow-hidden">
        <div className="divide-y divide-slate-800/60">
          {/* Header Row */}
          <div className="flex items-center gap-3 px-3 sm:px-4 py-2.5 bg-[#0b0e14]/70 text-xs font-medium text-slate-400">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={toggleCheckAll}
              aria-label="Select all entries"
              className="rounded border-slate-700 bg-[#0b0e14] text-emerald-500 cursor-pointer shrink-0"
            />
            <div className="flex-1 min-w-0">Name</div>
            <div className="hidden sm:block w-24 text-right">Size</div>
            <div className="hidden md:block w-36 text-right">Last Modified</div>
            <div className="w-16 text-right">Actions</div>
          </div>

          {/* Parent Directory Row */}
          {currentDir !== '' && (
            <div
              onClick={navigateUp}
              className="flex items-center gap-3 px-3 sm:px-4 py-3 text-xs hover:bg-slate-800/40 cursor-pointer transition-colors"
            >
              <div className="w-4 shrink-0" />
              <div className="flex-1 flex items-center gap-2.5 min-w-0 font-mono text-slate-300">
                <CornerLeftUp className="w-4 h-4 text-slate-500 shrink-0" />
                <span>..</span>
              </div>
              <div className="hidden sm:block w-24 text-right text-slate-500">Parent</div>
              <div className="hidden md:block w-36 text-right text-slate-500">—</div>
              <div className="w-16" />
            </div>
          )}

          {/* Directory & File Rows */}
          {currentItems.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              {searchQuery ? 'No files or directories match your search.' : 'This directory is empty.'}
            </div>
          ) : (
            currentItems.map((node) => {
              const isDir = node.type === 'directory';
              const isChecked = checkedPaths.has(node.path);
              return (
                <div
                  key={node.path}
                  onClick={() => (isDir ? navigateToDir(node.path) : void openFile(node.path))}
                  className={`flex items-center gap-3 px-3 sm:px-4 py-3 text-xs hover:bg-slate-800/40 cursor-pointer transition-colors ${
                    isChecked ? 'bg-emerald-950/20' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleCheck(node.path)}
                    aria-label={`Select ${node.name}`}
                    className="rounded border-slate-700 bg-[#0b0e14] text-emerald-500 cursor-pointer shrink-0"
                  />

                  <div className="flex-1 flex items-center gap-2.5 min-w-0">
                    {fileIcon(node)}
                    <div className="min-w-0">
                      <div className="font-mono text-slate-100 truncate">{node.name}</div>
                      <div className="sm:hidden text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
                        {isDir ? 'Directory' : formatBytes(node.size)}
                      </div>
                    </div>
                  </div>

                  <div className="hidden sm:block w-24 text-right font-mono tabular-nums text-slate-400 shrink-0">
                    {isDir ? 'Directory' : formatBytes(node.size)}
                  </div>

                  <div className="hidden md:block w-36 text-right font-mono tabular-nums text-slate-500 shrink-0">
                    {formatModified(node.modifiedAt)}
                  </div>

                  <div
                    className="w-16 flex items-center justify-end gap-1 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      title="Rename"
                      onClick={() => {
                        setRenamingPath(node.path);
                        setRenameTarget(node.name);
                      }}
                      className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      title="Delete"
                      onClick={() => setConfirmDeletePaths([node.path])}
                      className="p-1.5 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
