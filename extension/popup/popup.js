/**
 * 网页收藏家 - popup 管理界面
 * 直接访问扩展 origin 的 IndexedDB（与 service worker 共享数据）。
 */
import {
  listFolders,
  createFolder,
  renameFolder,
  removeFolderAndMoveItems,
  listItems,
  deleteItem,
  countItems,
  exportAll,
  importAll,
} from '../common/db.js';

const ICON = {
  folder:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  inbox:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
  edit:
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  trash:
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  copy:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  download:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  external:
    '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
};

const state = {
  folders: [],
  folderFilter: '__all__', // '__all__' | '' (未分类) | folderId
  search: '',
  objectUrls: new Set(),
};

const $ = (sel) => document.querySelector(sel);
const folderListEl = $('#folderList');
const itemListEl = $('#itemList');
const emptyEl = $('#emptyState');
const searchInput = $('#searchInput');
const toastEl = $('#toast');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => (n < 10 ? '0' : '') + n;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

function folderName(id) {
  if (!id) return '未分类';
  const f = state.folders.find((x) => x.id === id);
  return f ? f.name : '未分类';
}

/* ---------- 目录侧栏 ---------- */

async function renderFolders() {
  state.folders = await listFolders();
  const counts = await listItems({});
  const countOf = (id) =>
    id === '__all__' ? counts.length : counts.filter((it) => (id === '' ? !it.folderId : it.folderId === id)).length;

  const row = (key, name, icon) => `
    <button class="folder-item ${state.folderFilter === key ? 'active' : ''}" data-key="${esc(key)}">
      <span class="f-icon">${icon}</span>
      <span class="f-name">${esc(name)}</span>
      <span class="f-count">${countOf(key)}</span>
    </button>`;

  let html = row('__all__', '全部收藏', ICON.inbox) + row('', '未分类', ICON.folder);
  state.folders.forEach((f) => {
    const active = state.folderFilter === f.id ? 'active' : '';
    html += `
      <div class="folder-item ${active}" data-key="${esc(f.id)}">
        <span class="f-icon">${ICON.folder}</span>
        <span class="f-name">${esc(f.name)}</span>
        <span class="f-count">${countOf(f.id)}</span>
        <span class="f-ops">
          <button class="f-ren" title="重命名" data-id="${esc(f.id)}">${ICON.edit}</button>
          <button class="f-del" title="删除目录" data-id="${esc(f.id)}">${ICON.trash}</button>
        </span>
      </div>`;
  });
  folderListEl.innerHTML = html;

  folderListEl.querySelectorAll('[data-key]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.f-ops')) return;
      state.folderFilter = el.dataset.key;
      renderFolders().then(renderItems);
    });
  });
  folderListEl.querySelectorAll('.f-ren').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const f = state.folders.find((x) => x.id === btn.dataset.id);
      if (!f) return;
      const name = prompt('重命名目录：', f.name);
      if (name && name.trim()) {
        await renameFolder(f.id, name.trim());
        await renderFolders();
        renderItems();
      }
    })
  );
  folderListEl.querySelectorAll('.f-del').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const f = state.folders.find((x) => x.id === btn.dataset.id);
      if (!f) return;
      if (confirm(`删除目录「${f.name}」？目录内收藏将移至「未分类」。`)) {
        await removeFolderAndMoveItems(f.id);
        if (state.folderFilter === f.id) state.folderFilter = '__all__';
        await renderFolders();
        renderItems();
        toast('目录已删除');
      }
    })
  );
}

/* ---------- 收藏列表 ---------- */

function releaseObjectUrls() {
  state.objectUrls.forEach((u) => URL.revokeObjectURL(u));
  state.objectUrls.clear();
}

async function renderItems() {
  releaseObjectUrls();
  const opt = {};
  if (state.folderFilter !== '__all__') opt.folderId = state.folderFilter === '' ? null : state.folderFilter;
  if (state.search) opt.search = state.search;
  const items = await listItems(opt);

  $('#countLabel').textContent = `${(await countItems())} 条收藏`;
  emptyEl.hidden = items.length > 0;
  itemListEl.innerHTML = items
    .map((it) => {
      let body = '';
      if (it.type === 'image') {
        let src = '';
        if (it.imageBlob) {
          src = URL.createObjectURL(it.imageBlob);
          state.objectUrls.add(src);
        } else if (it.imageUrl) {
          src = it.imageUrl;
        }
        body = `<div class="item-img-wrap"><img src="${esc(src)}" alt="${esc(it.alt || '')}" loading="lazy"
          referrerpolicy="no-referrer" onerror="this.closest('.item-img-wrap').style.display='none'"/></div>`;
      } else {
        body = `<div class="item-body"><div class="item-text">${esc(it.text)}</div></div>`;
      }
      const favicon = it.favicon
        ? `<img class="favicon" src="${esc(it.favicon)}" referrerpolicy="no-referrer" onerror="this.style.display='none'"/>`
        : '';
      const link = it.pageUrl
        ? `<a href="${esc(it.pageUrl)}" target="_blank" rel="noopener" title="${esc(it.pageTitle || it.pageUrl)}">${ICON.external}${esc(it.pageTitle || it.pageUrl)}</a>`
        : '';
      const copyBtn =
        it.type === 'text'
          ? `<button class="op-copy" title="复制文字" data-id="${esc(it.id)}">${ICON.copy}</button>`
          : '';
      const downloadBtn =
        it.type === 'image'
          ? `<button class="op-dl" title="下载图片" data-id="${esc(it.id)}">${ICON.download}</button>`
          : '';
      return `
      <div class="item-card" data-id="${esc(it.id)}" data-type="${it.type}">
        ${body}
        <div class="item-meta">
          ${favicon}
          <span class="item-tag">${esc(folderName(it.folderId))}</span>
          <span>${fmtTime(it.createdAt)}</span>
          ${link}
          <span class="item-ops">
            ${copyBtn}
            ${downloadBtn}
            <button class="op-del" title="删除收藏">${ICON.trash}</button>
          </span>
        </div>
      </div>`;
    })
    .join('');

  itemListEl.querySelectorAll('.op-del').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const card = btn.closest('.item-card');
      await deleteItem(card.dataset.id);
      await renderFolders();
      renderItems();
      toast('已删除');
    })
  );
  itemListEl.querySelectorAll('.op-copy').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const card = btn.closest('.item-card');
      const items = await listItems({});
      const it = items.find((x) => x.id === card.dataset.id);
      if (!it) return;
      try {
        await navigator.clipboard.writeText(it.text);
        toast('文字已复制到剪贴板');
      } catch {
        toast('复制失败，请手动选择文本复制');
      }
    })
  );
  itemListEl.querySelectorAll('.op-dl').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const card = btn.closest('.item-card');
      const items = await listItems({});
      const it = items.find((x) => x.id === card.dataset.id);
      if (!it) return;
      let url = '';
      let revoke = false;
      if (it.imageBlob) {
        url = URL.createObjectURL(it.imageBlob);
        revoke = true;
      } else if (it.imageUrl) {
        url = it.imageUrl;
      }
      if (!url) return toast('图片数据不可用');
      try {
        const resp = await fetch(url);
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `web-collector-${it.id.slice(0, 8)}.${(it.imageMime || blob.type || 'image/png').split('/')[1] || 'png'}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
        toast('图片已开始下载');
      } catch {
        toast('下载失败（受站点保护），可点击图片链接查看原图');
      } finally {
        if (revoke) URL.revokeObjectURL(url);
      }
    })
  );
}

/* ---------- 新建目录 ---------- */

$('#newFolderBtn').addEventListener('click', async () => {
  const input = $('#newFolderInput');
  const name = input.value.trim();
  if (!name) return input.focus();
  await createFolder(name);
  input.value = '';
  await renderFolders();
  toast(`目录「${name}」已创建`);
});
$('#newFolderInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#newFolderBtn').click();
});

/* ---------- 搜索（防抖） ---------- */

let searchTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = searchInput.value.trim();
    renderItems();
  }, 180);
});

/* ---------- 备份导入导出 ---------- */

$('#exportBtn').addEventListener('click', async () => {
  const data = await exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `web-collector-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('备份已导出');
});

$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    await importAll(JSON.parse(text));
    await renderFolders();
    renderItems();
    toast('备份已导入');
  } catch {
    toast('导入失败：备份文件格式不正确');
  } finally {
    e.target.value = '';
  }
});

/* ---------- init ---------- */

renderFolders().then(renderItems);
window.addEventListener('beforeunload', releaseObjectUrls);
