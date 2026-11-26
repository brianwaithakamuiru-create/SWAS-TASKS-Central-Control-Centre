import { clearDriveConnection, getActiveDriveAccessToken } from './driveOAuth';

export type DriveViewScope = 'my_drive' | 'shared' | 'starred' | 'recent' | 'trash';
export type DriveMimeFilter = 'all' | 'folders' | 'workspace' | 'pdf' | 'images' | 'text';

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  createdTime?: string;
  starred?: boolean;
  trashed?: boolean;
  shared?: boolean;
  parents?: string[];
  webViewLink?: string;
  iconLink?: string;
  owners?: { displayName?: string; emailAddress?: string }[];
}

export interface DriveFileListResult {
  files: DriveFileItem[];
  nextPageToken?: string;
}

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const FILE_FIELDS =
  'files(id,name,mimeType,size,modifiedTime,createdTime,starred,trashed,shared,parents,webViewLink,iconLink,owners(displayName,emailAddress)),nextPageToken';

export const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

function requireAccessToken(): string {
  const token = getActiveDriveAccessToken();
  if (!token) {
    throw new Error('Google Drive is not connected. Sign in with Google to access Drive.');
  }
  return token;
}

function escapeDriveQueryValue(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function parseDriveError(res: Response, fallback: string): Promise<Error> {
  if (res.status === 401) {
    clearDriveConnection('Google Drive session expired. Please reconnect with Google.');
    return new Error('Google Drive session expired. Please sign in with Google again.');
  }
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body?.error?.message) {
      return new Error(body.error.message);
    }
  } catch {
    // ignore json parse failure
  }
  return new Error(`${fallback} (HTTP ${res.status})`);
}

export function safeExternalDriveUrl(url?: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

export function formatDriveBytes(bytesRaw?: string | number | null): string {
  if (bytesRaw === undefined || bytesRaw === null || bytesRaw === '') return '—';
  const bytes = typeof bytesRaw === 'string' ? Number(bytesRaw) : bytesRaw;
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let val = bytes / 1024;
  let unitIdx = 0;
  while (val >= 1024 && unitIdx < units.length - 1) {
    val /= 1024;
    unitIdx++;
  }
  return `${val.toFixed(val >= 10 ? 1 : 2)} ${units[unitIdx]}`;
}

export function getExportOptionsForMime(
  mimeType: string
): { label: string; mimeType: string; ext: string }[] {
  if (mimeType === 'application/vnd.google-apps.document') {
    return [
      { label: 'Export PDF', mimeType: 'application/pdf', ext: 'pdf' },
      {
        label: 'Export Word (.docx)',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ext: 'docx',
      },
      { label: 'Export Plain Text (.txt)', mimeType: 'text/plain', ext: 'txt' },
    ];
  }
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    return [
      {
        label: 'Export Excel (.xlsx)',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ext: 'xlsx',
      },
      { label: 'Export CSV (.csv)', mimeType: 'text/csv', ext: 'csv' },
      { label: 'Export PDF', mimeType: 'application/pdf', ext: 'pdf' },
    ];
  }
  if (mimeType === 'application/vnd.google-apps.presentation') {
    return [
      { label: 'Export PDF', mimeType: 'application/pdf', ext: 'pdf' },
      {
        label: 'Export PowerPoint (.pptx)',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ext: 'pptx',
      },
    ];
  }
  return [];
}

export function isEditableTextMime(mimeType: string, name?: string): boolean {
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/javascript'
  ) {
    return true;
  }
  if (name) {
    const lower = name.toLowerCase();
    return (
      lower.endsWith('.json') ||
      lower.endsWith('.txt') ||
      lower.endsWith('.md') ||
      lower.endsWith('.csv') ||
      lower.endsWith('.log')
    );
  }
  return false;
}

export async function listDriveFiles(params: {
  view: DriveViewScope;
  folderId?: string;
  query?: string;
  mimeFilter?: DriveMimeFilter;
  pageToken?: string;
  pageSize?: number;
}): Promise<DriveFileListResult> {
  const token = requireAccessToken();
  const clauses: string[] = [];

  if (params.view === 'trash') {
    clauses.push('trashed = true');
  } else {
    clauses.push('trashed = false');
    if (params.view === 'shared') {
      clauses.push('sharedWithMe = true');
    } else if (params.view === 'starred') {
      clauses.push('starred = true');
    } else if (params.view === 'my_drive' && !params.query?.trim()) {
      const parentId = escapeDriveQueryValue(params.folderId || 'root');
      clauses.push(`'${parentId}' in parents`);
    }
  }

  const trimmedQuery = params.query?.trim();
  if (trimmedQuery) {
    const escaped = escapeDriveQueryValue(trimmedQuery);
    clauses.push(`name contains '${escaped}'`);
  }

  if (params.mimeFilter === 'folders') {
    clauses.push(`mimeType = '${FOLDER_MIME_TYPE}'`);
  } else if (params.mimeFilter === 'workspace') {
    clauses.push(
      "(mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.google-apps.presentation' or mimeType = 'application/vnd.google-apps.form')"
    );
  } else if (params.mimeFilter === 'pdf') {
    clauses.push("mimeType = 'application/pdf'");
  } else if (params.mimeFilter === 'images') {
    clauses.push("mimeType contains 'image/'");
  } else if (params.mimeFilter === 'text') {
    clauses.push(
      "(mimeType contains 'text/' or mimeType = 'application/json')"
    );
  }

  const searchParams = new URLSearchParams({
    q: clauses.join(' and '),
    fields: FILE_FIELDS,
    pageSize: String(params.pageSize || 50),
    orderBy: params.view === 'recent' ? 'viewedByMeTime desc,modifiedTime desc' : 'folder,modifiedTime desc',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  if (params.pageToken) {
    searchParams.set('pageToken', params.pageToken);
  }

  const res = await fetch(`${DRIVE_API_BASE}/files?${searchParams.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw await parseDriveError(res, 'Failed to list Google Drive files');
  }
  const data = (await res.json()) as {
    files?: DriveFileItem[];
    nextPageToken?: string;
  };
  return {
    files: data.files || [],
    nextPageToken: data.nextPageToken,
  };
}

export async function createDriveFolder(
  name: string,
  parentId?: string
): Promise<DriveFileItem> {
  const token = requireAccessToken();
  const cleanName = name.trim();
  if (!cleanName) {
    throw new Error('Folder name is required.');
  }

  const metadata: Record<string, unknown> = {
    name: cleanName,
    mimeType: FOLDER_MIME_TYPE,
  };
  if (parentId && parentId !== 'root') {
    metadata.parents = [parentId];
  }

  const res = await fetch(`${DRIVE_API_BASE}/files?fields=id,name,mimeType,modifiedTime,parents,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
  });
  if (!res.ok) {
    throw await parseDriveError(res, 'Failed to create Google Drive folder');
  }
  return (await res.json()) as DriveFileItem;
}

export async function uploadDriveFile(
  file: File,
  parentId?: string
): Promise<DriveFileItem> {
  const token = requireAccessToken();
  const metadata: Record<string, unknown> = {
    name: file.name,
  };
  if (parentId && parentId !== 'root') {
    metadata.parents = [parentId];
  }

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', file);

  const res = await fetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,parents,webViewLink`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }
  );
  if (!res.ok) {
    throw await parseDriveError(res, `Failed to upload ${file.name}`);
  }
  return (await res.json()) as DriveFileItem;
}

export async function uploadDriveTextFile(
  name: string,
  content: string,
  mimeType = 'application/json',
  parentId?: string
): Promise<DriveFileItem> {
  const blob = new Blob([content], { type: mimeType });
  const file = new File([blob], name, { type: mimeType });
  return uploadDriveFile(file, parentId);
}

export async function renameDriveFile(
  fileId: string,
  newName: string
): Promise<DriveFileItem> {
  const token = requireAccessToken();
  const cleanName = newName.trim();
  if (!cleanName) {
    throw new Error('New file name cannot be empty.');
  }

  const res = await fetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: cleanName }),
    }
  );
  if (!res.ok) {
    throw await parseDriveError(res, 'Failed to rename Google Drive item');
  }
  return (await res.json()) as DriveFileItem;
}

export async function updateDriveTextFileContent(
  fileId: string,
  content: string,
  mimeType = 'text/plain'
): Promise<DriveFileItem> {
  const token = requireAccessToken();
  const res = await fetch(
    `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,mimeType,size,modifiedTime`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': mimeType,
      },
      body: content,
    }
  );
  if (!res.ok) {
    throw await parseDriveError(res, 'Failed to update file content in Google Drive');
  }
  return (await res.json()) as DriveFileItem;
}

export async function toggleDriveFileStarred(
  fileId: string,
  starred: boolean
): Promise<DriveFileItem> {
  const token = requireAccessToken();
  const res = await fetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=id,starred`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ starred }),
    }
  );
  if (!res.ok) {
    throw await parseDriveError(res, 'Failed to update starred status');
  }
  return (await res.json()) as DriveFileItem;
}

export async function setDriveFileTrashed(
  fileId: string,
  trashed: boolean
): Promise<DriveFileItem> {
  const token = requireAccessToken();
  const res = await fetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=id,trashed`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ trashed }),
    }
  );
  if (!res.ok) {
    throw await parseDriveError(res, trashed ? 'Failed to move file to trash' : 'Failed to restore file');
  }
  return (await res.json()) as DriveFileItem;
}

export async function deleteDriveFilePermanently(fileId: string): Promise<void> {
  const token = requireAccessToken();
  const res = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw await parseDriveError(res, 'Failed to delete file permanently');
  }
}

export async function downloadDriveFileBlob(fileId: string): Promise<Blob> {
  const token = requireAccessToken();
  const res = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw await parseDriveError(res, 'Failed to download file from Google Drive');
  }
  return res.blob();
}

export async function exportGoogleWorkspaceFileBlob(
  fileId: string,
  exportMimeType: string
): Promise<Blob> {
  const token = requireAccessToken();
  const search = new URLSearchParams({ mimeType: exportMimeType });
  const res = await fetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/export?${search.toString()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!res.ok) {
    throw await parseDriveError(res, 'Failed to export Google Workspace file');
  }
  return res.blob();
}

export async function fetchDriveTextPreview(
  fileId: string
): Promise<{ text: string; truncated: boolean }> {
  const blob = await downloadDriveFileBlob(fileId);
  const MAX_BYTES = 256 * 1024;
  const truncated = blob.size > MAX_BYTES;
  const slice = truncated ? blob.slice(0, MAX_BYTES) : blob;
  const text = await slice.text();
  return { text, truncated };
}
