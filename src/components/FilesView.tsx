import { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import type { FileNode } from '../shared/types.ts';
import { CodeMirrorEditor } from './CodeMirrorEditor.tsx';

interface FilesViewProps {
  initialFilePath?: string | null;
  onToast: (level: 'success' | 'warn' | 'error', title: string, message: string) => void;
}

export function FilesView({ initialFilePath, onToast }: FilesViewProps) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['plugins', 'src', 'src/server']));
  const [selectedPath, setSelectedPath] = useState<string>('plugins/essentials.ts');
  const [savedContent, setSavedContent] = useState<string>('');
  const [editorContent, setEditorContent] = useState<string>('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);

  // Inline create / rename / delete confirmation states (no window.prompt / window.confirm)
  const [creatingMode, setCreatingMode] = useState<'file' | 'directory' | null>(null);
  const [newEntryPath, setNewEntryPath] = useState('');
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState('');
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);

  const loadTree = useCallback(async () => {
    const res = await fetch('/api/files/tree');
    const data = await res.json();
    setTree(data.tree ?? []);
  }, []);

  const openFile = useCallback(async (filePath: string) => {
    setLoadingFile(true);
    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to read file');
      setSelectedPath(data.path);
      setSavedContent(data.content);
      setEditorContent(data.content);
    } catch (err) {
      onToast('error', 'Read Error', (err as Error).message);
    } finally {
      setLoadingFile(false);
    }
  }, [onToast]);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  useEffect(() => {
    const target = initialFilePath || 'plugins/essentials.ts';
    void openFile(target);
  }, [initialFilePath, openFile]);

  const isDirty = editorContent !== savedContent;

  const handleSave = useCallback(async () => {
    if (!selectedPath || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/files/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedPath, content: editorContent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save file');
      setSavedContent(editorContent);
      if (!data.hotReloadedPlugin) {
        onToast('success', 'File Saved', `Saved ${selectedPath} (${data.size} bytes)`);
      }
      void loadTree();
    } catch (err) {
      onToast('error', 'Save Failed', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [selectedPath, editorContent, saving, onToast, loadTree]);

  const handleCreateEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creatingMode || !newEntryPath.trim()) return;
    try {
      const res = await fetch('/api/files/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newEntryPath.trim(), type: creatingMode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Create failed');
      setTree(data.tree ?? []);
      setCreatingMode(null);
      setNewEntryPath('');
      if (creatingMode === 'file') {
        await openFile(data.path);
      }
      onToast('success', 'Created', `${data.path}`);
    } catch (err) {
      onToast('error', 'Create Failed', (err as Error).message);
    }
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingPath || !renameTarget.trim()) return;
    try {
      const res = await fetch('/api/files/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: renamingPath, newPath: renameTarget.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Rename failed');
      setTree(data.tree ?? []);
      if (selectedPath === renamingPath) {
        setSelectedPath(data.path);
      }
      setRenamingPath(null);
      onToast('success', 'Renamed', `${data.path}`);
    } catch (err) {
      onToast('error', 'Rename Failed', (err as Error).message);
    }
  };

  const handleDeleteConfirm = async (targetPath: string) => {
    try {
      const res = await fetch('/api/files/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setTree(data.tree ?? []);
      setConfirmDeletePath(null);
      onToast('warn', 'Deleted', `Removed ${targetPath}`);
    } catch (err) {
      onToast('error', 'Delete Failed', (err as Error).message);
    }
  };

  const toggleDir = (dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  };

  const renderTree = (nodes: FileNode[], depth = 0) => {
    return nodes.map((node) => {
      const isDir = node.type === 'directory';
      const isExpanded = expandedDirs.has(node.path);
      const isSelected = selectedPath === node.path;

      return (
        <div key={node.path}>
          <div
            className={`group flex items-center justify-between gap-1 px-2 py-1.5 rounded text-xs cursor-pointer transition-colors ${
              isSelected
                ? 'bg-emerald-950/50 text-emerald-300'
                : 'text-slate-300 hover:bg-slate-800/50'
            }`}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            onClick={() => (isDir ? toggleDir(node.path) : openFile(node.path))}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              {isDir ? (
                <>
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  )}
                  {isExpanded ? (
                    <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  ) : (
                    <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  )}
                </>
              ) : (
                <FileCode2 className="w-3.5 h-3.5 text-sky-400 shrink-0 ml-4" />
              )}
              <span className="truncate font-mono">{node.name}</span>
            </div>

            <div
              className="hidden group-hover:flex items-center gap-1 shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                title="Rename"
                onClick={() => {
                  setRenamingPath(node.path);
                  setRenameTarget(node.path);
                }}
                className="p-0.5 text-slate-400 hover:text-slate-100 cursor-pointer"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                title="Delete"
                onClick={() => setConfirmDeletePath(node.path)}
                className="p-0.5 text-slate-400 hover:text-rose-400 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>

          {isDir && isExpanded && node.children && (
            <div>{renderTree(node.children, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[calc(100vh-8.5rem)]">
      {/* File Explorer Sidebar */}
      <div className="lg:col-span-3 bg-[#111620] border border-slate-800/80 rounded-lg flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-800/80">
          <span className="text-xs font-semibold text-slate-200">Server Files</span>
          <div className="flex items-center gap-1">
            <button
              title="New File"
              onClick={() => {
                setCreatingMode('file');
                setNewEntryPath('plugins/custom_plugin.ts');
              }}
              className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-pointer"
            >
              <FilePlus className="w-3.5 h-3.5" />
            </button>
            <button
              title="New Folder"
              onClick={() => {
                setCreatingMode('directory');
                setNewEntryPath('worlds');
              }}
              className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
            <button
              title="Refresh Tree"
              onClick={() => void loadTree()}
              className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {creatingMode && (
          <form onSubmit={handleCreateEntry} className="p-2.5 border-b border-slate-800/80 bg-[#0b0e14] space-y-2">
            <div className="text-xs text-slate-400">
              Create {creatingMode === 'file' ? 'File' : 'Folder'} (relative path)
            </div>
            <input
              type="text"
              value={newEntryPath}
              onChange={(e) => setNewEntryPath(e.target.value)}
              autoFocus
              className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#111620] border border-slate-700 rounded text-slate-100 focus:outline-none focus:border-emerald-500"
            />
            <div className="flex items-center gap-1.5">
              <button
                type="submit"
                className="px-2.5 py-1 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded cursor-pointer"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setCreatingMode(null)}
                className="px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {renamingPath && (
          <form onSubmit={handleRenameSubmit} className="p-2.5 border-b border-slate-800/80 bg-[#0b0e14] space-y-2">
            <div className="text-xs text-slate-400">Rename {renamingPath}</div>
            <input
              type="text"
              value={renameTarget}
              onChange={(e) => setRenameTarget(e.target.value)}
              autoFocus
              className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#111620] border border-slate-700 rounded text-slate-100 focus:outline-none focus:border-emerald-500"
            />
            <div className="flex items-center gap-1.5">
              <button
                type="submit"
                className="px-2.5 py-1 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded cursor-pointer"
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() => setRenamingPath(null)}
                className="px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {confirmDeletePath && (
          <div className="p-2.5 border-b border-rose-900/50 bg-rose-950/30 space-y-2">
            <div className="text-xs text-rose-200 font-mono break-all">Delete {confirmDeletePath}?</div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleDeleteConfirm(confirmDeletePath)}
                className="px-2.5 py-1 text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white rounded cursor-pointer"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmDeletePath(null)}
                className="px-2.5 py-1 text-xs text-slate-300 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">{renderTree(tree)}</div>
      </div>

      {/* CodeMirror 6 IDE Workspace */}
      <div className="lg:col-span-9 bg-[#111620] border border-slate-800/80 rounded-lg flex flex-col overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5 min-w-0 text-xs">
            <FileCode2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-mono text-slate-100 truncate">{selectedPath}</span>
            {isDirty && <span className="text-amber-400 shrink-0">· Unsaved changes</span>}
            {selectedPath.startsWith('plugins/') && (
              <span className="text-emerald-400/90 shrink-0">· Auto Hot-Reload on Save</span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => openFile(selectedPath)}
              disabled={loadingFile}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <X className="w-3.5 h-3.5 hidden" />
              <RefreshCw className="w-3.5 h-3.5" />
              Revert
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving...' : 'Save (Ctrl+S)'}
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 bg-[#0d1118]">
          {loadingFile ? (
            <div className="h-full flex items-center justify-center text-xs text-slate-400">
              Loading {selectedPath}...
            </div>
          ) : (
            <CodeMirrorEditor
              value={editorContent}
              filename={selectedPath}
              onChange={setEditorContent}
              onSave={handleSave}
            />
          )}
        </div>
      </div>
    </div>
  );
}
