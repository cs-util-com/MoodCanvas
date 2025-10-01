/* istanbul ignore file */

const DB_NAME = 'moodcanvas';
const DB_VERSION = 1;
const PROJECT_LIMIT_BYTES = 150 * 1024 * 1024;
const GLOBAL_LIMIT_BYTES = 600 * 1024 * 1024;

let dbPromise;

export async function ensureProject({ name = 'Untitled Room' } = {}) {
  const db = await getDb();
  const tx = db.transaction('projects', 'readwrite');
  const store = tx.objectStore('projects');
  const now = new Date().toISOString();
  const project = {
    id: generateId(),
    name,
    createdAt: now,
    updatedAt: now,
    settings: { units: 'm', theme: 'plum-peach' },
    caps: { perProjectMB: 150 },
  };
  store.put(project);
  await transactionDone(tx);
  return project;
}

export async function getProject(id) {
  if (!id) return null;
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects');
    const request = tx.objectStore('projects').get(id);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function upsertProject(project) {
  const db = await getDb();
  const tx = db.transaction('projects', 'readwrite');
  const store = tx.objectStore('projects');
  store.put({ ...project, updatedAt: new Date().toISOString() });
  await transactionDone(tx);
}

export async function appendEvent(projectId, event) {
  const db = await getDb();
  const tx = db.transaction('events', 'readwrite');
  const store = tx.objectStore('events');
  store.put({
    id: generateId(),
    projectId,
    createdAt: new Date().toISOString(),
    ...event,
  });
  await transactionDone(tx);
}

export async function saveMedia(projectId, media) {
  const db = await getDb();
  const tx = db.transaction('media', 'readwrite');
  const store = tx.objectStore('media');
  const entry = {
    id: generateId(),
    projectId,
    createdAt: new Date().toISOString(),
    ...media,
  };
  store.put(entry);
  await transactionDone(tx);
  await enforceProjectLimit(db, projectId);
  await enforceGlobalLimit(db);
  return entry;
}

export async function saveArtifact(projectId, artifact) {
  const db = await getDb();
  const tx = db.transaction('artifacts', 'readwrite');
  const store = tx.objectStore('artifacts');
  const entry = {
    id: generateId(),
    projectId,
    createdAt: new Date().toISOString(),
    ...artifact,
  };
  store.put(entry);
  await transactionDone(tx);
  return entry;
}

export async function listMedia(projectId, kind) {
  const db = await getDb();
  return getAllByIndex(db, 'media', 'by-project-kind', [projectId, kind]);
}

export async function listArtifacts(projectId, kind) {
  const db = await getDb();
  return getAllByIndex(db, 'artifacts', 'by-project-kind', [projectId, kind]);
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = openDatabase(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('projects')) {
          const store = db.createObjectStore('projects', { keyPath: 'id' });
          store.createIndex('by-updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('events')) {
          const store = db.createObjectStore('events', { keyPath: 'id' });
          store.createIndex('by-project', 'projectId');
        }
        if (!db.objectStoreNames.contains('media')) {
          const store = db.createObjectStore('media', { keyPath: 'id' });
          store.createIndex('by-project-kind', ['projectId', 'kind']);
          store.createIndex('by-createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('artifacts')) {
          const store = db.createObjectStore('artifacts', { keyPath: 'id' });
          store.createIndex('by-project-kind', ['projectId', 'kind']);
          store.createIndex('by-createdAt', 'createdAt');
        }
      },
    });
  }
  return dbPromise;
}

function openDatabase(name, version, { upgrade } = {}) {
  if (!('indexedDB' in window)) {
    return Promise.reject(new Error('IndexedDB is not available in this environment'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = (event) => {
      upgrade?.(request.result, event.oldVersion, event.newVersion, request.transaction);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => console.warn('IndexedDB upgrade blocked');
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

async function enforceProjectLimit(db, projectId) {
  const total = await sumMediaBytes(db, (record) => record.projectId === projectId);
  if (total <= PROJECT_LIMIT_BYTES) return;
  await evictRenders(db, (record) => record.projectId === projectId, total - PROJECT_LIMIT_BYTES);
}

async function enforceGlobalLimit(db) {
  const total = await sumMediaBytes(db);
  if (total <= GLOBAL_LIMIT_BYTES) return;
  await evictRenders(db, () => true, total - GLOBAL_LIMIT_BYTES);
}

async function sumMediaBytes(db, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('media');
    const store = tx.objectStore('media');
    let total = 0;
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const value = cursor.value;
        if (predicate(value)) {
          total += value.bytes ?? 0;
        }
        cursor.continue();
      } else {
        resolve(total);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

function getAllByIndex(db, storeName, indexName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName);
    const index = tx.objectStore(storeName).index(indexName);
    const request = index.getAll(key);
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
}

async function evictRenders(db, predicate, requiredBytes) {
  await new Promise((resolve, reject) => {
    const tx = db.transaction('media', 'readwrite');
    const index = tx.objectStore('media').index('by-createdAt');
    let remaining = requiredBytes;
    const request = index.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || remaining <= 0) {
        resolve();
        return;
      }
      const value = cursor.value;
      if (value.kind === 'render' && predicate(value)) {
        remaining -= value.bytes ?? 0;
        cursor.delete();
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}
