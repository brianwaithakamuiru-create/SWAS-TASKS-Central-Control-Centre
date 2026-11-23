import { firebaseConfig } from './config.ts';

type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { timestampValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

interface FirestoreRestDoc {
  name?: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
}

const DATABASE_ID =
  firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
    ? firebaseConfig.firestoreDatabaseId
    : '(default)';

const BASE_DOC_URL = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${DATABASE_ID}/documents`;

function fromFirestoreValue(val: FirestoreValue): unknown {
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map(fromFirestoreValue);
  }
  if ('mapValue' in val) {
    const out: Record<string, unknown> = {};
    const fields = val.mapValue.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = fromFirestoreValue(v);
    }
    return out;
  }
  return null;
}

function toFirestoreValue(val: unknown): FirestoreValue {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (Number.isInteger(val)) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, FirestoreValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function parseDoc(doc: FirestoreRestDoc): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (doc.name) {
    const segments = doc.name.split('/');
    result.id = segments[segments.length - 1];
  }
  if (doc.fields) {
    for (const [k, v] of Object.entries(doc.fields)) {
      result[k] = fromFirestoreValue(v);
    }
  }
  return result;
}

function buildHeaders(idToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }
  return headers;
}

export async function firestoreGetDoc(
  collectionName: string,
  docId: string,
  idToken?: string
): Promise<Record<string, unknown> | null> {
  const url = `${BASE_DOC_URL}/${encodeURIComponent(collectionName)}/${encodeURIComponent(docId)}`;
  const res = await fetch(url, { headers: buildHeaders(idToken) });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firestore GET ${collectionName}/${docId} failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as FirestoreRestDoc;
  return parseDoc(data);
}

export async function firestoreListCollection(
  collectionName: string,
  idToken: string,
  pageSize = 200
): Promise<Record<string, unknown>[]> {
  const url = `${BASE_DOC_URL}/${encodeURIComponent(collectionName)}?pageSize=${pageSize}`;
  const res = await fetch(url, { headers: buildHeaders(idToken) });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firestore LIST ${collectionName} failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { documents?: FirestoreRestDoc[] };
  return (data.documents || []).map(parseDoc);
}

export async function firestoreSetDoc(
  collectionName: string,
  docId: string,
  payload: Record<string, unknown>,
  idToken: string
): Promise<Record<string, unknown>> {
  const url = `${BASE_DOC_URL}/${encodeURIComponent(collectionName)}/${encodeURIComponent(docId)}`;
  const fields: Record<string, FirestoreValue> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined) {
      fields[k] = toFirestoreValue(v);
    }
  }
  const res = await fetch(url, {
    method: 'PATCH',
    headers: buildHeaders(idToken),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firestore PATCH ${collectionName}/${docId} failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as FirestoreRestDoc;
  return parseDoc(data);
}

export async function firestorePatchFields(
  collectionName: string,
  docId: string,
  payload: Record<string, unknown>,
  idToken: string
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams();
  const fields: Record<string, FirestoreValue> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined) {
      params.append('updateMask.fieldPaths', k);
      fields[k] = toFirestoreValue(v);
    }
  }
  const url = `${BASE_DOC_URL}/${encodeURIComponent(collectionName)}/${encodeURIComponent(docId)}?${params.toString()}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: buildHeaders(idToken),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firestore PATCH fields ${collectionName}/${docId} failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as FirestoreRestDoc;
  return parseDoc(data);
}
