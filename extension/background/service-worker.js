/**
 * 网页收藏家 - background service worker (MV3, ES module)
 * 职责：
 *  1. 消息路由（content script / popup 的数据请求）
 *  2. 跨域抓取图片为 Blob（扩展拥有 host_permissions，不受页面 CORS 限制）
 *  3. 注册右键菜单
 *  4. 处理「打开 popup」请求
 */

import {
  openDB,
  listFolders,
  createFolder,
  renameFolder,
  removeFolderAndMoveItems,
  addItem,
  listItems,
  deleteItem,
  moveItem,
  countItems,
  exportAll,
  importAll,
} from '../common/db.js';

const FETCH_TIMEOUT = 15000;

/** 抓取图片为 Blob；失败返回 null（调用方降级为仅存原图 URL） */
async function fetchImageBlob(url) {
  if (!url) return null;
  if (url.startsWith('data:')) {
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      return blob.type.startsWith('image/') ? blob : null;
    } catch {
      return null;
    }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const resp = await fetch(url, { signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    if (!blob.type || !blob.type.startsWith('image/')) return null;
    return blob;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function handleSaveItem(payload) {
  const base = {
    pageUrl: payload.pageUrl || '',
    pageTitle: payload.pageTitle || '',
    favicon: payload.favicon || '',
    folderId: payload.folderId || null,
  };

  if (payload.type === 'text') {
    const text = String(payload.text || '').trim();
    if (!text) return { ok: false, error: '没有可收藏的文字' };
    await addItem({ ...base, type: 'text', text: text.slice(0, 20000) });
    return { ok: true };
  }

  // image：先抓图，抓不到则降级保存原图链接（popup 中用原图地址兜底展示）
  const imageUrl = payload.imageUrl || '';
  if (!imageUrl) return { ok: false, error: '没有可收藏的图片' };
  const blob = await fetchImageBlob(imageUrl);
  await addItem({
    ...base,
    type: 'image',
    imageBlob: blob,
    imageMime: blob ? blob.type : '',
    imageUrl,
    alt: payload.alt || '',
  });
  return { ok: true, degraded: !blob };
}

/* ---------------- 消息路由 ---------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case 'PING':
          sendResponse({ ok: true });
          break;
        case 'GET_FOLDERS':
          sendResponse({ ok: true, folders: await listFolders() });
          break;
        case 'CREATE_FOLDER':
          sendResponse({ ok: true, folder: await createFolder(msg.name) });
          break;
        case 'RENAME_FOLDER':
          sendResponse({ ok: true, folder: await renameFolder(msg.id, msg.name) });
          break;
        case 'DELETE_FOLDER':
          await removeFolderAndMoveItems(msg.id);
          sendResponse({ ok: true });
          break;
        case 'SAVE_ITEM':
          sendResponse(await handleSaveItem(msg.payload || {}));
          break;
        case 'GET_ITEMS':
          sendResponse({
            ok: true,
            items: await listItems({ folderId: msg.folderId, search: msg.search, type: msg.itemType }),
          });
          break;
        case 'DELETE_ITEM':
          await deleteItem(msg.id);
          sendResponse({ ok: true });
          break;
        case 'MOVE_ITEM':
          await moveItem(msg.id, msg.folderId);
          sendResponse({ ok: true });
          break;
        case 'COUNT_ITEMS':
          sendResponse({ ok: true, count: await countItems() });
          break;
        case 'EXPORT_ALL':
          sendResponse({ ok: true, data: await exportAll() });
          break;
        case 'IMPORT_ALL':
          await importAll(msg.data);
          sendResponse({ ok: true });
          break;
        case 'OPEN_POPUP': {
          try {
            if (chrome.action?.openPopup) {
              await chrome.action.openPopup();
              sendResponse({ ok: true });
            } else {
              sendResponse({ ok: false });
            }
          } catch {
            sendResponse({ ok: false });
          }
          break;
        }
        case 'CONTEXT_COLLECT': {
          // 由 background 主动发起的右键收藏请求转发给 content script（此处为 content -> bg 的兜底，不应到达）
          sendResponse({ ok: false });
          break;
        }
        default:
          sendResponse({ ok: false, error: '未知消息类型' });
      }
    } catch (err) {
      console.error('[web-collector] message error:', err);
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true; // 异步 sendResponse
});

/* ---------------- 右键菜单 ---------------- */

chrome.runtime.onInstalled.addListener(async () => {
  await openDB().catch(() => {});
  try {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: 'wc-save-selection',
      title: '收藏选中文字到「网页收藏家」',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'wc-save-image',
      title: '收藏此图片到「网页收藏家」',
      contexts: ['image'],
    });
  } catch (err) {
    console.warn('[web-collector] contextMenus init failed:', err);
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === 'wc-save-selection') {
    chrome.tabs.sendMessage(tab.id, { type: 'WC_TRIGGER_COLLECT', kind: 'selection' }).catch(() => {});
  } else if (info.menuItemId === 'wc-save-image') {
    chrome.tabs
      .sendMessage(tab.id, { type: 'WC_TRIGGER_COLLECT', kind: 'image', imageUrl: info.srcUrl || '' })
      .catch(() => {});
  }
});
