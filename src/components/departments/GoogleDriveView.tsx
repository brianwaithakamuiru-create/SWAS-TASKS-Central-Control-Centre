import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Edit3,
  ExternalLink,
  File as FileIcon,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  LogOut,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Share2,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  connectGoogleDriveAccount,
  disconnectGoogleDriveAccount,
  refreshDriveConnectionProfile,
  useDriveConnection,
} from '../../services/driveOAuth';
import {
  createDriveFolder,
  deleteDriveFilePermanently,
  downloadDriveFileBlob,
  exportGoogleWorkspaceFileBlob,
  fetchDriveTextPreview,
  FOLDER_MIME_TYPE,
  formatDriveBytes,
  getExportOptionsForMime,
  isEditableTextMime,
  listDriveFiles,
  renameDriveFile,
  safeExternalDriveUrl,
  setDriveFileTrashed,
  toggleDriveFileStarred,
  updateDriveTextFileContent,
  uploadDriveFile,
  uploadDriveTextFile,
  type DriveFileItem,
  type DriveMimeFilter,
  type DriveViewScope,
} from '../../services/googleDriveService';
import type { PlatformSetting } from '../../types/admin';
import { ConfirmModal } from '../common/ConfirmModal';
import { EmptyState } from '../common/EmptyState';
import { StatusText } from '../common/StatusText';

interface GoogleDriveViewProps {
  scopedDepartmentLabel?: string;
  settingsDocs?: PlatformSetting[];
}

interface FolderCrumb {
  id: string;
  name: string;
}

type PendingMutation =
  | { type: 'rename'; file: DriveFileItem; newName: string }
  | { type: 'trash'; files: DriveFileItem[] }
  | { type: 'restore'; file: DriveFileItem }
  | { type: 'delete_forever'; files: DriveFileItem[] }
  | { type: 'overwrite_text'; file: DriveFileItem; content: string }
  | { type: 'disconnect' };

function renderFileTypeIcon(mimeType: string) {
  if (mimeType === FOLDER_MIME_TYPE) {
    return <Folder className="w-4 h-4 text-[#1265C8] shrink-0" />;
  }
  if (mimeType === 'application/vnd.google-apps.spreadsheet' || mimeType.includes('sheet') || mimeType === 'text/csv') {
    return <FileSpreadsheet className="w-4 h-4 text-[#15966B] shrink-0" />;
  }
  if (mimeType.startsWith('image/')) {
    return <ImageIcon className="w-4 h-4 text-amber-600 shrink-0" />;
  }
  if (mimeType === 'application/json' || mimeType.includes('script') || mimeType.includes('xml')) {
    return <FileCode2 className="w-4 h-4 text-indigo-600 shrink-0" />;
  }
  if (mimeType === 'application/vnd.google-apps.document' || mimeType === 'application/pdf' || mimeType.startsWith('text/')) {
    return <FileText className="w-4 h-4 text-[#102B50] shrink-0" />;
  }
  return <FileIcon className="w-4 h-4 text-[#75869D] shrink-0" />;
}

function getFriendlyMimeLabel(mimeType: string): string {
  if (mimeType === FOLDER_MIME_TYPE) return 'Folder';
  if (mimeType === 'application/vnd.google-apps.document') return 'Google Doc';
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return 'Google Sheet';
  if (mimeType === 'application/vnd.google-apps.presentation') return 'Google Slides';
  if (mimeType === 'application/vnd.google-apps.form') return 'Google Form';
  if (mimeType === 'application/pdf') return 'PDF Document';
  if (mimeType === 'application/json') return 'JSON File';
  if (mimeType.startsWith('image/')) return mimeType.replace('image/', '').toUpperCase() + ' Image';
  if (mimeType.startsWith('text/')) return mimeType.replace('text/', '').toUpperCase() + ' Text';
  return mimeType.split('/').pop() || 'File';
}

export function GoogleDriveView({
  scopedDepartmentLabel,
  settingsDocs = [],
}: GoogleDriveViewProps) {
  const { adminProfile } = useAuth();
  const driveConn = useDriveConnection();

  const [view, setView] = useState<DriveViewScope>('my_drive');
  const [breadcrumbs, setBreadcrumbs] = useState<FolderCrumb[]>([
    { id: 'root', name: 'My Drive' },
  ]);
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [mimeFilter, setMimeFilter] = useState<DriveMimeFilter>('all');

  const [files, setFiles] = useState<DriveFileItem[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [inspectedFile, setInspectedFile] = useState<DriveFileItem | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewTruncated, setPreviewTruncated] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [editingText, setEditingText] = useState(false);
  const [editedTextDraft, setEditedTextDraft] = useState('');

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

  const [renameTarget, setRenameTarget] = useState<DriveFileItem | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const [uploading, setUploading] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [pendingMutation, setPendingMutation] = useState<PendingMutation | null>(null);

  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentFolder = breadcrumbs[breadcrumbs.length - 1] || { id: 'root', name: 'My Drive' };

  const loadFiles = useCallback(
    async (append = false, pageToken?: string) => {
      if (!driveConn.connected) return;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoadingFiles(true);
      }
      try {
        const result = await listDriveFiles({
          view,
          folderId: currentFolder.id,
          query: appliedQuery,
          mimeFilter,
          pageToken,
          pageSize: 50,
        });
        setFiles((prev) => (append ? [...prev, ...result.files] : result.files));
        setNextPageToken(result.nextPageToken);
        if (!append) setSelectedIds([]);
      } catch (err) {
        setFeedback({
          type: 'err',
          text: err instanceof Error ? err.message : 'Unable to load Google Drive files.',
        });
      } finally {
        setLoadingFiles(false);
        setLoadingMore(false);
      }
    },
    [driveConn.connected, view, currentFolder.id, appliedQuery, mimeFilter]
  );

  useEffect(() => {
    if (driveConn.connected) {
      void loadFiles(false);
    } else {
      setFiles([]);
      setSelectedIds([]);
      setInspectedFile(null);
    }
  }, [driveConn.connected, loadFiles]);

  // Revoke object URL when image preview changes or unmounts
  useEffect(() => {
    return () => {
      if (previewImageUrl) {
        URL.revokeObjectURL(previewImageUrl);
      }
    };
  }, [previewImageUrl]);

  const handleConnectDrive = async () => {
    setConnecting(true);
    setFeedback(null);
    try {
      const snap = await connectGoogleDriveAccount();
      setFeedback({
        type: 'ok',
        text: `Connected Google Drive as ${snap.connectedEmail || snap.displayName || 'Google user'}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to connect Google Drive.',
      });
    } finally {
      setConnecting(false);
    }
  };

  const handleRefreshProfileAndFiles = async () => {
    setFeedback(null);
    try {
      await refreshDriveConnectionProfile();
      await loadFiles(false);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to refresh Google Drive.',
      });
    }
  };

  const handleOpenFolder = (folder: DriveFileItem) => {
    setView('my_drive');
    setAppliedQuery('');
    setSearchInput('');
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const handleSwitchView = (nextView: DriveViewScope) => {
    setView(nextView);
    setInspectedFile(null);
    if (nextView === 'my_drive') {
      setBreadcrumbs([{ id: 'root', name: 'My Drive' }]);
    }
  };

  const handleInspectFile = async (file: DriveFileItem) => {
    if (file.mimeType === FOLDER_MIME_TYPE) {
      handleOpenFolder(file);
      return;
    }

    setInspectedFile(file);
    setPreviewText(null);
    setPreviewTruncated(false);
    setEditingText(false);
    setEditedTextDraft('');
    if (previewImageUrl) {
      URL.revokeObjectURL(previewImageUrl);
      setPreviewImageUrl(null);
    }

    if (isEditableTextMime(file.mimeType, file.name)) {
      setLoadingPreview(true);
      try {
        const res = await fetchDriveTextPreview(file.id);
        setPreviewText(res.text);
        setPreviewTruncated(res.truncated);
        setEditedTextDraft(res.text);
      } catch (err) {
        setFeedback({
          type: 'err',
          text: err instanceof Error ? err.message : 'Failed to load file preview.',
        });
      } finally {
        setLoadingPreview(false);
      }
    } else if (file.mimeType.startsWith('image/')) {
      setLoadingPreview(true);
      try {
        const blob = await downloadDriveFileBlob(file.id);
        setPreviewImageUrl(URL.createObjectURL(blob));
      } catch (err) {
        setFeedback({
          type: 'err',
          text: err instanceof Error ? err.message : 'Failed to load image preview.',
        });
      } finally {
        setLoadingPreview(false);
      }
    }
  };

  const handleDownloadFile = async (file: DriveFileItem) => {
    setFeedback(null);
    try {
      const exportOptions = getExportOptionsForMime(file.mimeType);
      if (exportOptions.length > 0) {
        const first = exportOptions[0];
        const blob = await exportGoogleWorkspaceFileBlob(file.id, first.mimeType);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${file.name}.${first.ext}`;
        a.click();
        URL.revokeObjectURL(url);
        setFeedback({ type: 'ok', text: `Exported "${file.name}" (${first.label}).` });
        return;
      }

      const blob = await downloadDriveFileBlob(file.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
      setFeedback({ type: 'ok', text: `Downloaded "${file.name}".` });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Download failed.',
      });
    }
  };

  const handleExportWorkspaceFile = async (
    file: DriveFileItem,
    exportMime: string,
    ext: string
  ) => {
    setFeedback(null);
    try {
      const blob = await exportGoogleWorkspaceFileBlob(file.id, exportMime);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${file.name}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      setFeedback({ type: 'ok', text: `Exported "${file.name}.${ext}".` });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Export failed.',
      });
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    setFeedback(null);
    try {
      const parentId = view === 'my_drive' ? currentFolder.id : 'root';
      const created = await createDriveFolder(newFolderName.trim(), parentId);
      setNewFolderName('');
      setNewFolderOpen(false);
      setFeedback({ type: 'ok', text: `Folder "${created.name}" created in Google Drive.` });
      await loadFiles(false);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Could not create folder.',
      });
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    e.target.value = '';
    if (selected.length === 0) return;

    setUploading(true);
    setFeedback(null);
    try {
      const parentId = view === 'my_drive' ? currentFolder.id : 'root';
      for (const file of selected) {
        await uploadDriveFile(file, parentId);
      }
      setFeedback({
        type: 'ok',
        text:
          selected.length === 1
            ? `Uploaded "${selected[0].name}" to Google Drive.`
            : `Uploaded ${selected.length} files to Google Drive.`,
      });
      await loadFiles(false);
      await refreshDriveConnectionProfile().catch(() => undefined);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'File upload failed.',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleSaveSnapshotToDrive = async () => {
    setBackingUp(true);
    setFeedback(null);
    try {
      const parentId = view === 'my_drive' ? currentFolder.id : 'root';
      const dateStamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const fileName = `swas-tasks-control-snapshot-${dateStamp}.json`;
      const payload = {
        platform: 'SWAS TASKS Central Control Centre',
        exportedAt: new Date().toISOString(),
        exportedBy: adminProfile?.email || driveConn.connectedEmail || 'administrator',
        departmentScope: scopedDepartmentLabel || 'All Control Centre',
        platformSettingsCount: settingsDocs.length,
        platformSettings: settingsDocs,
      };
      await uploadDriveTextFile(
        fileName,
        JSON.stringify(payload, null, 2),
        'application/json',
        parentId
      );
      setFeedback({
        type: 'ok',
        text: `Saved Control Centre snapshot "${fileName}" to Google Drive.`,
      });
      await loadFiles(false);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Snapshot backup to Drive failed.',
      });
    } finally {
      setBackingUp(false);
    }
  };

  const handleToggleStar = async (file: DriveFileItem) => {
    setFeedback(null);
    try {
      await toggleDriveFileStarred(file.id, !file.starred);
      setFiles((prev) =>
        prev.map((item) =>
          item.id === file.id ? { ...item, starred: !file.starred } : item
        )
      );
      if (inspectedFile?.id === file.id) {
        setInspectedFile({ ...inspectedFile, starred: !file.starred });
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Could not update star status.',
      });
    }
  };

  const executePendingMutation = async () => {
    if (!pendingMutation) return;
    setFeedback(null);
    try {
      if (pendingMutation.type === 'disconnect') {
        await disconnectGoogleDriveAccount();
        setPendingMutation(null);
        setFeedback({ type: 'ok', text: 'Disconnected Google Drive session.' });
        return;
      }

      if (pendingMutation.type === 'rename') {
        const updated = await renameDriveFile(
          pendingMutation.file.id,
          pendingMutation.newName
        );
        setFiles((prev) =>
          prev.map((f) => (f.id === updated.id ? { ...f, name: updated.name } : f))
        );
        if (inspectedFile?.id === updated.id) {
          setInspectedFile({ ...inspectedFile, name: updated.name });
        }
        setRenameTarget(null);
        setFeedback({ type: 'ok', text: `Renamed item to "${updated.name}".` });
      } else if (pendingMutation.type === 'trash') {
        for (const f of pendingMutation.files) {
          await setDriveFileTrashed(f.id, true);
        }
        setFeedback({
          type: 'ok',
          text:
            pendingMutation.files.length === 1
              ? `Moved "${pendingMutation.files[0].name}" to Trash.`
              : `Moved ${pendingMutation.files.length} items to Trash.`,
        });
        if (
          inspectedFile &&
          pendingMutation.files.some((f) => f.id === inspectedFile.id)
        ) {
          setInspectedFile(null);
        }
        await loadFiles(false);
      } else if (pendingMutation.type === 'restore') {
        await setDriveFileTrashed(pendingMutation.file.id, false);
        setFeedback({
          type: 'ok',
          text: `Restored "${pendingMutation.file.name}" from Trash.`,
        });
        await loadFiles(false);
      } else if (pendingMutation.type === 'delete_forever') {
        for (const f of pendingMutation.files) {
          await deleteDriveFilePermanently(f.id);
        }
        setFeedback({
          type: 'ok',
          text:
            pendingMutation.files.length === 1
              ? `Permanently deleted "${pendingMutation.files[0].name}".`
              : `Permanently deleted ${pendingMutation.files.length} items.`,
        });
        if (
          inspectedFile &&
          pendingMutation.files.some((f) => f.id === inspectedFile.id)
        ) {
          setInspectedFile(null);
        }
        await loadFiles(false);
      } else if (pendingMutation.type === 'overwrite_text') {
        const updated = await updateDriveTextFileContent(
          pendingMutation.file.id,
          pendingMutation.content,
          pendingMutation.file.mimeType || 'text/plain'
        );
        setPreviewText(pendingMutation.content);
        setEditingText(false);
        setInspectedFile({
          ...pendingMutation.file,
          size: updated.size || pendingMutation.file.size,
          modifiedTime: updated.modifiedTime || pendingMutation.file.modifiedTime,
        });
        setFeedback({
          type: 'ok',
          text: `Updated contents of "${pendingMutation.file.name}" in Google Drive.`,
        });
        await loadFiles(false);
      }
      setPendingMutation(null);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Google Drive action failed.',
      });
      setPendingMutation(null);
    }
  };

  const selectedFiles = useMemo(
    () => files.filter((f) => selectedIds.includes(f.id)),
    [files, selectedIds]
  );

  const toggleSelectAll = () => {
    if (selectedIds.length === files.length && files.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(files.map((f) => f.id));
    }
  };

  const toggleSelectOne = (fileId: string) => {
    setSelectedIds((prev) =>
      prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId]
    );
  };

  const quotaPct = useMemo(() => {
    if (!driveConn.storageQuota?.limitBytes || driveConn.storageQuota.limitBytes <= 0) {
      return null;
    }
    return Math.min(
      100,
      Math.round((driveConn.storageQuota.usageBytes / driveConn.storageQuota.limitBytes) * 100)
    );
  }, [driveConn.storageQuota]);

  const confirmCopy = useMemo(() => {
    if (!pendingMutation) {
      return { title: '', description: '', confirmLabel: 'Confirm', danger: false };
    }
    if (pendingMutation.type === 'disconnect') {
      return {
        title: 'Disconnect Google Drive?',
        description:
          'This clears the in-memory Google Drive access token for this browser session. You can sign in again anytime.',
        confirmLabel: 'Disconnect',
        danger: true,
      };
    }
    if (pendingMutation.type === 'rename') {
      return {
        title: 'Rename Google Drive Item?',
        description: `Update the name of "${pendingMutation.file.name}" to "${pendingMutation.newName}" in Google Drive?`,
        confirmLabel: 'Confirm Rename',
        danger: false,
      };
    }
    if (pendingMutation.type === 'trash') {
      const count = pendingMutation.files.length;
      return {
        title: count === 1 ? `Move "${pendingMutation.files[0].name}" to Trash?` : `Move ${count} items to Trash?`,
        description:
          count === 1
            ? `This will move "${pendingMutation.files[0].name}" to Google Drive Trash.`
            : `Selected items (${pendingMutation.files.map((f) => f.name).slice(0, 3).join(', ')}${count > 3 ? `, +${count - 3} more` : ''}) will be moved to Google Drive Trash.`,
        confirmLabel: 'Move to Trash',
        danger: true,
      };
    }
    if (pendingMutation.type === 'restore') {
      return {
        title: `Restore "${pendingMutation.file.name}"?`,
        description: `Restore "${pendingMutation.file.name}" from Google Drive Trash back into Drive?`,
        confirmLabel: 'Restore File',
        danger: false,
      };
    }
    if (pendingMutation.type === 'delete_forever') {
      const count = pendingMutation.files.length;
      return {
        title:
          count === 1
            ? `Permanently delete "${pendingMutation.files[0].name}"?`
            : `Permanently delete ${count} items from Google Drive?`,
        description:
          count === 1
            ? `Are you sure you want to permanently delete "${pendingMutation.files[0].name}"? This action cannot be undone.`
            : `Are you sure you want to permanently delete ${count} selected items (${pendingMutation.files.map((f) => f.name).slice(0, 3).join(', ')}${count > 3 ? `, +${count - 3} more` : ''})? This action cannot be undone.`,
        confirmLabel: 'Delete Permanently',
        danger: true,
      };
    }
    return {
      title: `Update contents of "${pendingMutation.file.name}"?`,
      description: `This will overwrite the existing file content of "${pendingMutation.file.name}" in Google Drive.`,
      confirmLabel: 'Overwrite File',
      danger: false,
    };
  }, [pendingMutation]);

  const inspectedExternalUrl = safeExternalDriveUrl(inspectedFile?.webViewLink);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="typo-page-heading text-[#172B46] flex items-center gap-2.5">
            <HardDrive className="w-6 h-6 text-[#1265C8]" />
            <span>
              Google Drive Workspace
              {scopedDepartmentLabel ? ` · ${scopedDepartmentLabel}` : ''}
            </span>
          </h1>
          <p className="mt-1 typo-body text-[#75869D]">
            Browse, search, upload, organize, export, and back up SWAS TASKS operational documents directly in Google Drive.
          </p>
        </div>

        {driveConn.connected ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={backingUp}
              onClick={() => void handleSaveSnapshotToDrive()}
              className="inline-flex items-center gap-1.5 px-3 py-2 typo-nav bg-white border border-slate-200 hover:bg-[#E9F2FF] hover:text-[#1265C8] text-[#172B46] rounded-md transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4 text-[#1265C8]" />
              <span>{backingUp ? 'Saving...' : 'Save Snapshot to Drive'}</span>
            </button>
            <button
              type="button"
              onClick={() => setNewFolderOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 typo-nav bg-white border border-slate-200 hover:bg-[#F3F6FA] text-[#172B46] rounded-md transition-colors"
            >
              <FolderPlus className="w-4 h-4 text-[#102B50]" />
              <span>New Folder</span>
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md transition-colors disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              <span>{uploading ? 'Uploading...' : 'Upload File'}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(e) => void handleFileUpload(e)}
              className="hidden"
            />
          </div>
        ) : null}
      </div>

      {feedback ? (
        <div
          className={`p-3 rounded-md typo-meta border flex items-center justify-between gap-3 ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-[#15966B]'
              : 'bg-red-50 border-red-200 text-[#D34552]'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="Dismiss message"
            className="opacity-70 hover:opacity-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : null}

      {/* Sign in with Google Card when disconnected */}
      {!driveConn.connected ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 sm:p-8 max-w-3xl space-y-5">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-lg bg-[#E9F2FF] text-[#1265C8] flex items-center justify-center shrink-0">
              <HardDrive className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="typo-section-heading text-[#172B46]">
                  Connect Your Google Drive Account
                </h2>
                <StatusText status="pending" label="Authorization Required" />
              </div>
              <p className="typo-body text-[#75869D]">
                Authorize Google Drive for this Control Centre session to browse folders, upload
                reports, export Google Docs and Sheets, and back up platform configuration snapshots.
                Tokens stay strictly in memory for your active session and are cleared on sign-out.
              </p>
            </div>
          </div>

          {driveConn.lastError ? (
            <div className="p-3 rounded-md bg-red-50 border border-red-200 typo-meta text-[#D34552]">
              {driveConn.lastError}
            </div>
          ) : null}

          <div className="pt-1 flex flex-wrap items-center gap-4">
            <button
              type="button"
              disabled={connecting || driveConn.checking}
              onClick={() => void handleConnectDrive()}
              className="inline-flex items-center gap-3 px-4 py-2.5 rounded-md border border-[#747775] bg-white hover:bg-[#F7F8F9] active:bg-[#EEEFF1] text-[#1F1F1F] text-sm font-medium shadow-xs transition-colors disabled:opacity-60"
            >
              <svg
                version="1.1"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 48 48"
                className="w-5 h-5 block shrink-0"
                aria-hidden="true"
              >
                <path
                  fill="#EA4335"
                  d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                />
                <path
                  fill="#4285F4"
                  d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                />
                <path
                  fill="#FBBC05"
                  d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                />
                <path
                  fill="#34A853"
                  d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                />
                <path fill="none" d="M0 0h48v48H0z" />
              </svg>
              <span>
                {connecting || driveConn.checking
                  ? 'Connecting Google Drive...'
                  : 'Sign in with Google'}
              </span>
            </button>
            <span className="typo-meta text-[#75869D]">
              Signing into Google Drive here does not change your Control Centre admin account (
              <span className="font-medium text-[#172B46]">{adminProfile?.email}</span>).
            </span>
          </div>
        </div>
      ) : (
        <>
          {/* Connected Account & Quota Banner */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              {driveConn.photoUrl ? (
                <img
                  src={driveConn.photoUrl}
                  alt={driveConn.displayName || 'Google account'}
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 rounded-full object-cover border border-slate-200 shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-[#102B50] text-white text-sm font-semibold flex items-center justify-center shrink-0">
                  {(driveConn.displayName || driveConn.connectedEmail || 'G').slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="typo-card-heading text-[#172B46] truncate">
                    {driveConn.displayName || 'Google Drive Connected'}
                  </p>
                  <StatusText status="connected" label="Google Drive Connected" />
                </div>
                <p className="typo-meta text-[#75869D] truncate">
                  {driveConn.connectedEmail}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              {driveConn.storageQuota ? (
                <div className="min-w-[200px] space-y-1">
                  <div className="flex items-center justify-between typo-small text-[#75869D]">
                    <span>Drive Storage</span>
                    <span className="tabular-nums font-medium text-[#172B46]">
                      {formatDriveBytes(driveConn.storageQuota.usageBytes)}
                      {driveConn.storageQuota.limitBytes
                        ? ` / ${formatDriveBytes(driveConn.storageQuota.limitBytes)}`
                        : ' used'}
                    </span>
                  </div>
                  {quotaPct !== null ? (
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#1265C8] rounded-full transition-all"
                        style={{ width: `${quotaPct}%` }}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={loadingFiles || driveConn.checking}
                  onClick={() => void handleRefreshProfileAndFiles()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-meta font-medium text-[#172B46] bg-[#F3F6FA] hover:bg-[#E9F2FF] border border-slate-200 rounded-md transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingFiles ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => setPendingMutation({ type: 'disconnect' })}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-meta font-medium text-[#D34552] bg-red-50 hover:bg-red-100 border border-red-200 rounded-md transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Disconnect
                </button>
              </div>
            </div>
          </div>

          {/* New Folder Inline Form */}
          {newFolderOpen ? (
            <form
              onSubmit={(e) => void handleCreateFolder(e)}
              className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3"
            >
              <FolderPlus className="w-5 h-5 text-[#1265C8] shrink-0 hidden sm:block" />
              <input
                type="text"
                required
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder={`New folder inside ${view === 'my_drive' ? currentFolder.name : 'My Drive'}...`}
                className="flex-1 px-3 py-2 typo-input border border-slate-300 rounded-md focus:outline-none focus:border-[#1265C8]"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setNewFolderOpen(false);
                    setNewFolderName('');
                  }}
                  className="px-3 py-2 typo-meta font-medium text-[#75869D] hover:text-[#172B46]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingFolder || !newFolderName.trim()}
                  className="px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md disabled:opacity-50"
                >
                  {creatingFolder ? 'Creating...' : 'Create Folder'}
                </button>
              </div>
            </form>
          ) : null}

          {/* Drive View Tabs, Search, and Type Filter */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3.5">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
                {(
                  [
                    { id: 'my_drive', label: 'My Drive', icon: HardDrive },
                    { id: 'shared', label: 'Shared with Me', icon: Share2 },
                    { id: 'starred', label: 'Starred', icon: Star },
                    { id: 'recent', label: 'Recent', icon: CheckCircle2 },
                    { id: 'trash', label: 'Trash', icon: Trash2 },
                  ] as const
                ).map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => handleSwitchView(tab.id)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 typo-nav rounded-md whitespace-nowrap transition-colors shrink-0 ${
                        view === tab.id
                          ? 'bg-[#1265C8] text-white'
                          : 'bg-[#F3F6FA] text-[#172B46] hover:bg-[#E9F2FF]'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setAppliedQuery(searchInput.trim());
                }}
                className="flex flex-wrap items-center gap-2"
              >
                <div className="relative flex-1 sm:w-64">
                  <Search className="w-4 h-4 text-[#75869D] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Search files by name..."
                    className="w-full pl-9 pr-3 py-1.5 typo-input border border-slate-300 rounded-md focus:outline-none focus:border-[#1265C8]"
                  />
                </div>
                <select
                  value={mimeFilter}
                  onChange={(e) => setMimeFilter(e.target.value as DriveMimeFilter)}
                  aria-label="Filter by file type"
                  className="px-3 py-1.5 typo-input border border-slate-300 rounded-md bg-white focus:outline-none focus:border-[#1265C8]"
                >
                  <option value="all">All Types</option>
                  <option value="folders">Folders</option>
                  <option value="workspace">Docs, Sheets & Slides</option>
                  <option value="pdf">PDF Documents</option>
                  <option value="images">Images</option>
                  <option value="text">Text & JSON</option>
                </select>
                <button
                  type="submit"
                  className="px-3 py-1.5 typo-nav text-white bg-[#102B50] hover:bg-[#172B46] rounded-md"
                >
                  Search
                </button>
                {appliedQuery ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchInput('');
                      setAppliedQuery('');
                    }}
                    className="px-2.5 py-1.5 typo-meta text-[#75869D] hover:text-[#172B46]"
                  >
                    Clear
                  </button>
                ) : null}
              </form>
            </div>

            {/* Folder Breadcrumb Trail */}
            {view === 'my_drive' && !appliedQuery ? (
              <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100">
                <div className="flex items-center gap-1.5 overflow-x-auto typo-meta">
                  {breadcrumbs.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setBreadcrumbs((prev) => prev.slice(0, -1))}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#F3F6FA] hover:bg-[#E9F2FF] text-[#172B46] mr-1 shrink-0"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      Back
                    </button>
                  ) : null}
                  {breadcrumbs.map((crumb, idx) => (
                    <React.Fragment key={crumb.id}>
                      {idx > 0 ? <span className="text-[#75869D]">/</span> : null}
                      <button
                        type="button"
                        onClick={() => setBreadcrumbs((prev) => prev.slice(0, idx + 1))}
                        className={`px-1.5 py-0.5 rounded whitespace-nowrap ${
                          idx === breadcrumbs.length - 1
                            ? 'font-semibold text-[#172B46]'
                            : 'text-[#1265C8] hover:underline'
                        }`}
                      >
                        {crumb.name}
                      </button>
                    </React.Fragment>
                  ))}
                </div>

                {selectedFiles.length > 0 ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="typo-meta text-[#75869D] tabular-nums">
                      {selectedFiles.length} selected
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setPendingMutation({ type: 'trash', files: selectedFiles })
                      }
                      className="px-2.5 py-1 typo-meta font-medium text-[#D34552] bg-red-50 hover:bg-red-100 border border-red-200 rounded"
                    >
                      Move to Trash
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPendingMutation({ type: 'delete_forever', files: selectedFiles })
                      }
                      className="px-2.5 py-1 typo-meta font-medium text-white bg-[#D34552] hover:bg-[#b53743] rounded"
                    >
                      Delete Permanently
                    </button>
                  </div>
                ) : null}
              </div>
            ) : selectedFiles.length > 0 ? (
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <span className="typo-meta text-[#75869D] tabular-nums">
                  {selectedFiles.length} selected
                </span>
                {view !== 'trash' ? (
                  <button
                    type="button"
                    onClick={() =>
                      setPendingMutation({ type: 'trash', files: selectedFiles })
                    }
                    className="px-2.5 py-1 typo-meta font-medium text-[#D34552] bg-red-50 hover:bg-red-100 border border-red-200 rounded"
                  >
                    Move to Trash
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    setPendingMutation({ type: 'delete_forever', files: selectedFiles })
                  }
                  className="px-2.5 py-1 typo-meta font-medium text-white bg-[#D34552] hover:bg-[#b53743] rounded"
                >
                  Delete Permanently
                </button>
              </div>
            ) : null}
          </div>

          {/* File Browser Table + Inspector Split */}
          <div className={`grid gap-6 ${inspectedFile ? 'grid-cols-1 xl:grid-cols-12' : 'grid-cols-1'}`}>
            <div className={`${inspectedFile ? 'xl:col-span-7' : ''} bg-white border border-slate-200 rounded-lg overflow-hidden`}>
              {loadingFiles ? (
                <div className="p-10 text-center space-y-2">
                  <div className="w-7 h-7 border-2 border-[#1265C8] border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="typo-meta text-[#75869D]">Loading Google Drive files...</p>
                </div>
              ) : files.length === 0 ? (
                <EmptyState
                  title={appliedQuery ? 'No Matching Drive Files' : 'This Google Drive View Is Empty'}
                  description={
                    appliedQuery
                      ? `No files matched "${appliedQuery}". Clear the search or switch views.`
                      : view === 'trash'
                      ? 'No trashed items found in Google Drive.'
                      : 'Upload a file, create a folder, or save a Control Centre snapshot to get started.'
                  }
                />
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full typo-table">
                      <thead className="bg-[#F3F6FA] text-[#75869D] text-left border-b border-slate-200">
                        <tr>
                          <th className="pl-4 pr-2 py-3 w-8">
                            <input
                              type="checkbox"
                              checked={files.length > 0 && selectedIds.length === files.length}
                              onChange={toggleSelectAll}
                              aria-label="Select all Drive files"
                            />
                          </th>
                          <th className="px-3 py-3 font-medium">Name</th>
                          <th className="px-3 py-3 font-medium hidden sm:table-cell">Type</th>
                          <th className="px-3 py-3 font-medium hidden md:table-cell">Modified</th>
                          <th className="px-3 py-3 font-medium hidden md:table-cell text-right">Size</th>
                          <th className="px-4 py-3 font-medium text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {files.map((file) => {
                          const isFolder = file.mimeType === FOLDER_MIME_TYPE;
                          const isSelected = selectedIds.includes(file.id);
                          const isInspected = inspectedFile?.id === file.id;
                          return (
                            <tr
                              key={file.id}
                              className={`hover:bg-slate-50 transition-colors ${
                                isInspected ? 'bg-[#E9F2FF]/60' : ''
                              }`}
                            >
                              <td className="pl-4 pr-2 py-3">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleSelectOne(file.id)}
                                  aria-label={`Select ${file.name}`}
                                />
                              </td>
                              <td className="px-3 py-3 max-w-[260px]">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  {renderFileTypeIcon(file.mimeType)}
                                  <button
                                    type="button"
                                    onClick={() => void handleInspectFile(file)}
                                    className="font-medium text-[#172B46] hover:text-[#1265C8] truncate text-left"
                                  >
                                    {file.name}
                                  </button>
                                </div>
                              </td>
                              <td className="px-3 py-3 typo-meta text-[#75869D] hidden sm:table-cell whitespace-nowrap">
                                {getFriendlyMimeLabel(file.mimeType)}
                              </td>
                              <td className="px-3 py-3 typo-meta text-[#75869D] tabular-nums hidden md:table-cell whitespace-nowrap">
                                {file.modifiedTime
                                  ? new Date(file.modifiedTime).toLocaleDateString()
                                  : '—'}
                              </td>
                              <td className="px-3 py-3 typo-meta text-[#75869D] tabular-nums hidden md:table-cell text-right whitespace-nowrap">
                                {isFolder ? '—' : formatDriveBytes(file.size)}
                              </td>
                              <td className="px-4 py-3 text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => void handleToggleStar(file)}
                                    title={file.starred ? 'Remove star' : 'Star item'}
                                    aria-label={file.starred ? 'Remove star' : 'Star item'}
                                    className={`p-1.5 rounded hover:bg-slate-100 ${
                                      file.starred ? 'text-amber-500' : 'text-[#75869D]'
                                    }`}
                                  >
                                    <Star
                                      className="w-3.5 h-3.5"
                                      fill={file.starred ? 'currentColor' : 'none'}
                                    />
                                  </button>
                                  {!isFolder ? (
                                    <button
                                      type="button"
                                      onClick={() => void handleDownloadFile(file)}
                                      title="Download / Export"
                                      aria-label={`Download ${file.name}`}
                                      className="p-1.5 rounded hover:bg-slate-100 text-[#1265C8]"
                                    >
                                      <Download className="w-3.5 h-3.5" />
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRenameTarget(file);
                                      setRenameDraft(file.name);
                                    }}
                                    title="Rename"
                                    aria-label={`Rename ${file.name}`}
                                    className="p-1.5 rounded hover:bg-slate-100 text-[#172B46]"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                  {view === 'trash' ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setPendingMutation({ type: 'restore', file })
                                        }
                                        title="Restore from Trash"
                                        aria-label={`Restore ${file.name}`}
                                        className="p-1.5 rounded hover:bg-emerald-50 text-[#15966B]"
                                      >
                                        <RotateCcw className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setPendingMutation({
                                            type: 'delete_forever',
                                            files: [file],
                                          })
                                        }
                                        title="Delete Permanently"
                                        aria-label={`Delete ${file.name} permanently`}
                                        className="p-1.5 rounded hover:bg-red-50 text-[#D34552]"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setPendingMutation({ type: 'trash', files: [file] })
                                      }
                                      title="Move to Trash"
                                      aria-label={`Move ${file.name} to Trash`}
                                      className="p-1.5 rounded hover:bg-red-50 text-[#D34552]"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {nextPageToken ? (
                    <div className="px-4 py-3 border-t border-slate-100 flex justify-center">
                      <button
                        type="button"
                        disabled={loadingMore}
                        onClick={() => void loadFiles(true, nextPageToken)}
                        className="px-4 py-1.5 typo-meta font-medium text-[#1265C8] bg-[#E9F2FF] hover:bg-blue-100 rounded-md disabled:opacity-50"
                      >
                        {loadingMore ? 'Loading more...' : 'Load More Files'}
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </div>

            {/* File Details, Preview & Text Editor Panel */}
            {inspectedFile ? (
              <div className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-4 self-start">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    {renderFileTypeIcon(inspectedFile.mimeType)}
                    <div className="min-w-0">
                      <h3 className="typo-card-heading text-[#172B46] break-words">
                        {inspectedFile.name}
                      </h3>
                      <p className="typo-meta text-[#75869D]">
                        {getFriendlyMimeLabel(inspectedFile.mimeType)}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setInspectedFile(null)}
                    aria-label="Close file details"
                    className="p-1 text-[#75869D] hover:text-[#172B46]"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <dl className="grid grid-cols-2 gap-3 p-3 rounded-md bg-[#F3F6FA] typo-meta">
                  <div>
                    <dt className="text-[#75869D]">Drive File ID</dt>
                    <dd className="font-mono text-[11px] text-[#172B46] break-all mt-0.5">
                      {inspectedFile.id}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#75869D]">Size</dt>
                    <dd className="text-[#172B46] tabular-nums mt-0.5">
                      {formatDriveBytes(inspectedFile.size)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#75869D]">Owner</dt>
                    <dd className="text-[#172B46] truncate mt-0.5">
                      {inspectedFile.owners?.[0]?.displayName ||
                        inspectedFile.owners?.[0]?.emailAddress ||
                        'Unknown'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#75869D]">Last Modified</dt>
                    <dd className="text-[#172B46] tabular-nums mt-0.5">
                      {inspectedFile.modifiedTime
                        ? new Date(inspectedFile.modifiedTime).toLocaleString()
                        : '—'}
                    </dd>
                  </div>
                </dl>

                {/* Download / Export / External View Actions */}
                <div className="flex flex-wrap items-center gap-2">
                  {getExportOptionsForMime(inspectedFile.mimeType).length > 0 ? (
                    getExportOptionsForMime(inspectedFile.mimeType).map((opt) => (
                      <button
                        key={opt.mimeType}
                        type="button"
                        onClick={() =>
                          void handleExportWorkspaceFile(
                            inspectedFile,
                            opt.mimeType,
                            opt.ext
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-meta font-medium text-[#1265C8] bg-[#E9F2FF] hover:bg-blue-100 rounded-md"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>{opt.label}</span>
                      </button>
                    ))
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleDownloadFile(inspectedFile)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-meta font-medium text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download File</span>
                    </button>
                  )}

                  {inspectedExternalUrl ? (
                    <a
                      href={inspectedExternalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-meta font-medium text-[#172B46] bg-[#F3F6FA] hover:bg-slate-200 rounded-md"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Open in Google Drive</span>
                    </a>
                  ) : null}
                </div>

                {/* Live Preview / Text Editor */}
                {loadingPreview ? (
                  <div className="p-6 text-center typo-meta text-[#75869D] border border-slate-200 rounded-md">
                    Loading preview from Google Drive...
                  </div>
                ) : previewImageUrl ? (
                  <div className="border border-slate-200 rounded-md p-2 bg-slate-50">
                    <img
                      src={previewImageUrl}
                      alt={inspectedFile.name}
                      className="max-h-72 mx-auto rounded object-contain"
                    />
                  </div>
                ) : previewText !== null ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="typo-label text-[#172B46]">
                        {editingText ? 'Edit File Content' : 'File Preview'}
                        {previewTruncated ? ' (first 256 KB)' : ''}
                      </span>
                      {!previewTruncated && !inspectedFile.trashed ? (
                        editingText ? (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingText(false);
                                setEditedTextDraft(previewText);
                              }}
                              className="typo-meta text-[#75869D] hover:text-[#172B46]"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setPendingMutation({
                                  type: 'overwrite_text',
                                  file: inspectedFile,
                                  content: editedTextDraft,
                                })
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 typo-meta font-semibold text-white bg-[#1265C8] hover:bg-[#102B50] rounded"
                            >
                              <Save className="w-3.5 h-3.5" />
                              Save to Drive
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditedTextDraft(previewText);
                              setEditingText(true);
                            }}
                            className="inline-flex items-center gap-1 typo-meta font-medium text-[#1265C8] hover:underline"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Edit File
                          </button>
                        )
                      ) : null}
                    </div>

                    {editingText ? (
                      <textarea
                        rows={12}
                        value={editedTextDraft}
                        onChange={(e) => setEditedTextDraft(e.target.value)}
                        className="w-full p-3 font-mono text-xs border border-slate-300 rounded-md focus:outline-none focus:border-[#1265C8]"
                      />
                    ) : (
                      <pre className="p-3 bg-[#F3F6FA] border border-slate-200 rounded-md font-mono text-xs text-[#172B46] max-h-72 overflow-auto whitespace-pre-wrap break-words">
                        {previewText}
                      </pre>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      )}

      {/* Rename Modal (requires confirmation before mutating Drive) */}
      {renameTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!renameDraft.trim() || renameDraft.trim() === renameTarget.name) return;
              setPendingMutation({
                type: 'rename',
                file: renameTarget,
                newName: renameDraft.trim(),
              });
            }}
            className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-6 space-y-4"
          >
            <h3 className="typo-card-heading text-[#172B46]">Rename Drive Item</h3>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                New Name
              </label>
              <input
                type="text"
                required
                autoFocus
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md focus:outline-none focus:border-[#1265C8]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                className="px-4 py-2 typo-button text-[#172B46] bg-slate-100 hover:bg-slate-200 rounded-md"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!renameDraft.trim() || renameDraft.trim() === renameTarget.name}
                className="px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* Mandatory Confirmation Dialog for ALL Destructive / Mutating Drive Calls */}
      <ConfirmModal
        open={Boolean(pendingMutation)}
        title={confirmCopy.title}
        description={confirmCopy.description}
        confirmLabel={confirmCopy.confirmLabel}
        danger={confirmCopy.danger}
        onCancel={() => setPendingMutation(null)}
        onConfirm={executePendingMutation}
      />
    </div>
  );
}
