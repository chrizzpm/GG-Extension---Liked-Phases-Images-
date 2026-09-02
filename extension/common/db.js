/**
 * 网页收藏家 - 共享数据层 (IndexedDB)
 * service worker 与 popup 同属扩展 origin，可直接共用本模块。
 *
 * 数据模型：
 *   folders: { id, name, createdAt }
 *   items:   { id, type: 'text' | 'image',
 *              text?, imageBlob?, imageMime?, imageUrl?, alt?,
 *              pageUrl, pageTitle, favicon, folderId (null = 未分类),
 *              createdAt }
 */

const DB_NAME = 'web-collector-db';
const DB_VERSION = 1;
const STORE_FOLDERS = 'folders';
const STORE_ITEMS = 'items';

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_FOLDERS)) {
        const f = db.createObjectStore(STORE_FOLDERS, { keyPath: 'id' });
        f.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains(STORE_ITEMS)) {
        const it = db.createObjectStore(STORE_ITEMS, { keyPath: 'id' });
        it.createIndex('folderId', 'folderId');
        it.createIndex('type', 'type');
        it.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function tx(db, store, mode = 'readonly') {
  return db.transaction(store, mode).objectStore(store);
}

function reqPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* ---------------- folders ---------------- */

export async function listFolders() {
  const db = await openDB();
  const items = await reqPromise(tx(db, STORE_FOLDERS).getAll());
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

export async function createFolder(name) {
  const db = await openDB();
  const folder = { id: uid(), name: String(name || '').trim().slice(0, 40) || '未命名目录', createdAt: Date.now() };
  await reqPromise(tx(db, STORE_FOLDERS, 'readwrite').put(folder));
  return folder;
}

export async function renameFolder(id, name) {
  const db = await openDB();
  const store = tx(db, STORE_FOLDERS, 'readwrite');
  const folder = await reqPromise(store.get(id));
  if (!folder) throw new Error('目录不存在');
  folder.name = String(name || '').trim().slice(0, 40) || folder.name;
  await reqPromise(store.put(folder));
  return folder;
}

/** 删除目录并把其下条目移动到未分类 (folderId = null) */
export async function removeFolderAndMoveItems(id) {
  const db = await openDB();
  const tr = db.transaction([STORE_FOLDERS, STORE_ITEMS], 'readwrite');
  const itemStore = tr.objectStore(STORE_ITEMS);
  await new Promise((resolve, reject) => {
    const idx = itemStore.index('folderId');
    const curReq = idx.openCursor(IDBKeyRange.only(id));
    curReq.onsuccess = () => {
      const cursor = curReq.result;
      if (cursor) {
        const item = cursor.value;
        item.folderId = null;
        cursor.update(item);
        cursor.continue();
      } else resolve();
    };
    curReq.onerror = () => reject(curReq.error);
  });
  await reqPromise(tr.objectStore(STORE_FOLDERS).delete(id));
}

/* ---------------- items ---------------- */

export async function addItem(data) {
  const db = await openDB();
  const item = {
    id: uid(),
    type: data.type === 'image' ? 'image' : 'text',
    text: data.text || '',
    imageBlob: data.imageBlob || null,
    imageMime: data.imageMime || '',
    imageUrl: data.imageUrl || '',
    alt: data.alt || '',
    pageUrl: data.pageUrl || '',
    pageTitle: data.pageTitle || '',
    favicon: data.favicon || '',
    folderId: data.folderId || null,
    createdAt: Date.now(),
  };
  await reqPromise(tx(db, STORE_ITEMS, 'readwrite').put(item));
  return item;
}

export async function listItems({ folderId = undefined, search = '', type = '' } = {}) {
  const db = await openDB();
  let items = await reqPromise(tx(db, STORE_ITEMS).getAll());
  if (folderId !== undefined) {
    items = items.filter((it) => (folderId === null ? !it.folderId : it.folderId === folderId));
  }
  if (type) items = items.filter((it) => it.type === type);
  const q = String(search || '').trim().toLowerCase();
  if (q) {
    items = items.filter((it) =>
      [it.text, it.alt, it.pageTitle, it.pageUrl].some((f) => String(f || '').toLowerCase().includes(q))
    );
  }
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteItem(id) {
  const db = await openDB();
  await reqPromise(tx(db, STORE_ITEMS, 'readwrite').delete(id));
}

export async function moveItem(id, folderId) {
  const db = await openDB();
  const store = tx(db, STORE_ITEMS, 'readwrite');
  const item = await reqPromise(store.get(id));
  if (!item) return;
  item.folderId = folderId || null;
  await reqPromise(store.put(item));
}

export async function countItems() {
  const db = await openDB();
  return reqPromise(tx(db, STORE_ITEMS).count());
}

/* ---------------- backup ---------------- */

export async function exportAll() {
  const db = await openDB();
  const [folders, items] = await Promise.all([
    reqPromise(tx(db, STORE_FOLDERS).getAll()),
    reqPromise(tx(db, STORE_ITEMS).getAll()),
  ]);
  const serialItems = await Promise.all(
    items.map(async (it) => {
      const copy = { ...it };
      if (it.imageBlob) {
        const buf = await it.imageBlob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        copy.imageDataUrl = `data:${it.imageMime || it.imageBlob.type || 'image/png'};base64,${btoa(bin)}`;
        delete copy.imageBlob;
      }
      return copy;
    })
  );
  return { version: 1, exportedAt: Date.now(), folders, items: serialItems };
}

export async function importAll(data) {
  if (!data || !Array.isArray(data.items)) throw new Error('备份文件格式不正确');
  const db = await openDB();
  const tr = db.transaction([STORE_FOLDERS, STORE_ITEMS], 'readwrite');
  const fStore = tr.objectStore(STORE_FOLDERS);
  const iStore = tr.objectStore(STORE_ITEMS);
  if (Array.isArray(data.folders)) {
    for (const f of data.folders) {
      if (f && f.id && f.name) fStore.put({ id: f.id, name: f.name, createdAt: f.createdAt || Date.now() });
    }
  }
  for (const it of data.items) {
    if (!it || !it.type) continue;
    const item = {
      id: it.id || uid(),
      type: it.type === 'image' ? 'image' : 'text',
      text: it.text || '',
      imageBlob: null,
      imageMime: it.imageMime || '',
      imageUrl: it.imageUrl || '',
      alt: it.alt || '',
      pageUrl: it.pageUrl || '',
      pageTitle: it.pageTitle || '',
      favicon: it.favicon || '',
      folderId: it.folderId || null,
      createdAt: it.createdAt || Date.now(),
    };
    if (it.imageDataUrl && it.imageDataUrl.startsWith('data:')) {
      try {
        const resp = await fetch(it.imageDataUrl);
        item.imageBlob = await resp.blob();
        item.imageMime = item.imageBlob.type || it.imageMime;
      } catch {
        /* 忽略损坏的图片 */
      }
    }
    iStore.put(item);
  }
  await new Promise((resolve, reject) => {
    tr.oncomplete = () => resolve();
    tr.onerror = () => reject(tr.error);
  });
}
