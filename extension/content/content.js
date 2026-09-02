/**
 * 网页收藏家 - content script
 * 功能：划词收藏按钮、图片悬停角标、图片拖拽投放球、目录选择模态、toast。
 * 全部 UI 注入 Shadow DOM，与宿主页面样式完全隔离。
 * 同一份代码在非扩展环境（落地页演示）自动切换为 localStorage 适配器。
 */
(function () {
  'use strict';

  if (window.__WC_COLLECTOR_LOADED__) return;
  window.__WC_COLLECTOR_LOADED__ = true;

  var HAS_CHROME =
    typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.sendMessage && chrome.runtime.id);

  /* ============================== 适配器 ============================== */

  function demoStorage() {
    var KEY = { folders: 'wc_demo_folders', items: 'wc_demo_items', last: 'wc_demo_last_folder' };
    function read(k, d) {
      try {
        var v = JSON.parse(localStorage.getItem(k));
        return v === undefined || v === null ? d : v;
      } catch (e) {
        return d;
      }
    }
    function write(k, v) {
      localStorage.setItem(k, JSON.stringify(v));
    }
    function uid(p) {
      return p + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    }
    return {
      isDemo: true,
      listFolders: function () {
        return Promise.resolve(read(KEY.folders, []));
      },
      createFolder: function (name) {
        var fs = read(KEY.folders, []);
        var f = { id: uid('f'), name: name, createdAt: Date.now() };
        fs.push(f);
        write(KEY.folders, fs);
        return Promise.resolve(f);
      },
      deleteFolder: function (id) {
        write(KEY.folders, read(KEY.folders, []).filter(function (f) { return f.id !== id; }));
        write(
          KEY.items,
          read(KEY.items, []).map(function (it) {
            return it.folderId === id ? Object.assign({}, it, { folderId: null }) : it;
          })
        );
        return Promise.resolve();
      },
      saveItem: function (p) {
        var items = read(KEY.items, []);
        items.push(Object.assign({ id: uid('i'), createdAt: Date.now() }, p));
        write(KEY.items, items);
        return Promise.resolve({ ok: true });
      },
      listItems: function (opt) {
        opt = opt || {};
        var items = read(KEY.items, []).slice();
        if (opt.folderId !== undefined) {
          items = items.filter(function (it) {
            return opt.folderId === null ? !it.folderId : it.folderId === opt.folderId;
          });
        }
        if (opt.search) {
          var q = String(opt.search).toLowerCase();
          items = items.filter(function (it) {
            return [it.text, it.alt, it.pageTitle].join(' ').toLowerCase().indexOf(q) >= 0;
          });
        }
        items.sort(function (a, b) { return b.createdAt - a.createdAt; });
        return Promise.resolve(items);
      },
      deleteItem: function (id) {
        write(KEY.items, read(KEY.items, []).filter(function (it) { return it.id !== id; }));
        return Promise.resolve();
      },
      getLastFolder: function () {
        return Promise.resolve(read(KEY.last, null));
      },
      setLastFolder: function (id) {
        write(KEY.last, id);
        return Promise.resolve();
      },
      openManager: function () {
        return Promise.resolve(false);
      },
    };
  }

  function chromeStorage() {
    function send(msg) {
      return new Promise(function (resolve) {
        try {
          chrome.runtime.sendMessage(msg, function (resp) {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(resp || { ok: false });
            }
          });
        } catch (e) {
          resolve({ ok: false, error: String(e) });
        }
      });
    }
    return {
      isDemo: false,
      listFolders: function () {
        return send({ type: 'GET_FOLDERS' }).then(function (r) { return r.folders || []; });
      },
      createFolder: function (name) {
        return send({ type: 'CREATE_FOLDER', name: name }).then(function (r) { return r.folder; });
      },
      deleteFolder: function (id) {
        return send({ type: 'DELETE_FOLDER', id: id });
      },
      saveItem: function (p) {
        return send({ type: 'SAVE_ITEM', payload: p });
      },
      listItems: function (opt) {
        return send({ type: 'GET_ITEMS', folderId: opt.folderId, search: opt.search }).then(function (r) {
          return r.items || [];
        });
      },
      deleteItem: function (id) {
        return send({ type: 'DELETE_ITEM', id: id });
      },
      getLastFolder: function () {
        return new Promise(function (resolve) {
          try {
            chrome.storage.local.get('wcLastFolderId', function (v) {
              resolve((v && v.wcLastFolderId) || null);
            });
          } catch (e) {
            resolve(null);
          }
        });
      },
      setLastFolder: function (id) {
        try {
          chrome.storage.local.set({ wcLastFolderId: id });
        } catch (e) { /* ignore */ }
        return Promise.resolve();
      },
      openManager: function () {
        return send({ type: 'OPEN_POPUP' }).then(function (r) { return !!(r && r.ok); });
      },
    };
  }

  var api = HAS_CHROME ? chromeStorage() : demoStorage();

  /* ============================== SVG 图标 ============================== */

  var ICONS = {
    bookmark:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
    plus:
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    folder:
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    trash:
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    close:
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    check:
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    image:
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    text:
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
    external:
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
    search:
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  };

  /* ============================== Shadow DOM ============================== */

  var host = document.createElement('div');
  host.id = '__wc_collector_host__';
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0; width: 0; height: 0;';
  var shadow = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;

  var STYLE = [
    ':host, .wc-root { all: initial; }',
    '.wc-root { position: fixed; inset: 0; pointer-events: none; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif; font-size: 14px; line-height: 1.6; color: #2B2A26; -webkit-font-smoothing: antialiased; }',
    '.wc-root * { box-sizing: border-box; margin: 0; padding: 0; }',
    '.wc-btn { pointer-events: auto; cursor: pointer; border: none; font-family: inherit; }',

    /* 悬浮收藏按钮（划词） */
    '.wc-text-btn { position: fixed; display: none; align-items: center; gap: 6px; background: #1F6F54; color: #fff; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; box-shadow: 0 6px 20px rgba(31,111,84,.35); transition: transform .15s cubic-bezier(.2,.9,.3,1.3), opacity .15s; transform-origin: top center; white-space: nowrap; }',
    '.wc-text-btn.show { display: flex; animation: wcPop .18s cubic-bezier(.2,.9,.3,1.3); }',
    '.wc-text-btn:hover { background: #154E3B; transform: translateY(-1px); }',
    '@keyframes wcPop { from { transform: scale(.85) translateY(4px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }',

    /* 图片悬停角标 */
    '.wc-img-badge { position: fixed; display: none; width: 34px; height: 34px; border-radius: 50%; background: rgba(31,111,84,.95); color: #fff; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(21,78,59,.4); transition: transform .15s cubic-bezier(.2,.9,.3,1.3), background .15s; }',
    '.wc-img-badge.show { display: flex; animation: wcPop .18s cubic-bezier(.2,.9,.3,1.3); }',
    '.wc-img-badge:hover { background: #E85D3F; transform: scale(1.12); }',

    /* 悬浮球 FAB */
    '.wc-fab { position: fixed; right: 26px; bottom: 96px; width: 46px; height: 46px; border-radius: 50%; background: #1F6F54; color: #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 24px rgba(21,78,59,.35); transition: transform .2s cubic-bezier(.2,.9,.3,1.3), background .2s, box-shadow .2s; }',
    '.wc-fab:hover { transform: translateY(-2px) scale(1.06); background: #154E3B; }',
    '.wc-fab.drop-ready { background: #E85D3F; animation: wcPulse 1s ease-in-out infinite; }',
    '.wc-fab.drop-active { transform: scale(1.25); background: #E85D3F; box-shadow: 0 0 0 8px rgba(232,93,63,.25), 0 10px 28px rgba(232,93,63,.45); }',
    '@keyframes wcPulse { 0%,100% { box-shadow: 0 8px 24px rgba(232,93,63,.35), 0 0 0 0 rgba(232,93,63,.4);} 50% { box-shadow: 0 8px 24px rgba(232,93,63,.35), 0 0 0 12px rgba(232,93,63,0);} }',
    '.wc-fab-tip { position: fixed; right: 80px; bottom: 108px; display: none; background: #2B2A26; color: #FAF6EF; font-size: 12px; padding: 7px 12px; border-radius: 8px; white-space: nowrap; box-shadow: 0 6px 18px rgba(0,0,0,.2); }',
    '.wc-fab-tip.show { display: block; animation: wcFade .2s ease; }',
    '@keyframes wcFade { from { opacity: 0; transform: translateX(6px);} to { opacity: 1; transform: none;} }',

    /* 遮罩与模态 */
    '.wc-overlay { position: fixed; inset: 0; background: rgba(43,42,38,.42); display: none; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(2px); }',
    '.wc-overlay.show { display: flex; animation: wcFade .18s ease; }',
    '.wc-modal { pointer-events: auto; width: 100%; max-width: 400px; max-height: 84vh; display: flex; flex-direction: column; background: #FAF6EF; border-radius: 12px; box-shadow: 0 24px 60px rgba(43,42,38,.28); overflow: hidden; animation: wcRise .22s cubic-bezier(.2,.9,.3,1.1); }',
    '@keyframes wcRise { from { transform: translateY(8px) scale(.98); opacity: 0;} to { transform: none; opacity: 1;} }',
    '.wc-modal-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px 10px; }',
    '.wc-modal-title { font-family: Georgia, "Songti SC", "Noto Serif SC", serif; font-size: 17px; font-weight: 700; color: #2B2A26; }',
    '.wc-x { width: 28px; height: 28px; border-radius: 8px; background: transparent; color: #8A8378; display: flex; align-items: center; justify-content: center; }',
    '.wc-x:hover { background: rgba(43,42,38,.08); color: #2B2A26; }',

    '.wc-preview { margin: 0 18px; padding: 12px 14px; background: #fff; border: 1px solid rgba(43,42,38,.08); border-left: 3px solid #E85D3F; border-radius: 8px; font-size: 13px; color: #4a463f; max-height: 130px; overflow: auto; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }',
    '.wc-preview img { max-width: 100%; max-height: 100px; border-radius: 6px; display: block; margin: 0 auto; }',
    '.wc-preview-meta { margin: 8px 18px 0; font-size: 11px; color: #8A8378; display: flex; align-items: center; gap: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',

    '.wc-sec-label { margin: 14px 18px 6px; font-size: 12px; font-weight: 600; color: #8A8378; letter-spacing: .5px; }',
    '.wc-folders { margin: 0 12px; padding: 4px 6px; overflow-y: auto; max-height: 200px; }',
    '.wc-folder-opt { pointer-events: auto; width: 100%; display: flex; align-items: center; gap: 9px; padding: 9px 10px; border-radius: 8px; background: transparent; border: none; font-size: 13.5px; color: #2B2A26; font-family: inherit; text-align: left; cursor: pointer; }',
    '.wc-folder-opt:hover { background: rgba(31,111,84,.08); }',
    '.wc-folder-opt.active { background: #E4EFE9; color: #154E3B; font-weight: 600; }',
    '.wc-folder-opt .wc-radio { width: 16px; height: 16px; border-radius: 50%; border: 2px solid #b9b2a4; flex: none; display: flex; align-items: center; justify-content: center; color: #fff; }',
    '.wc-folder-opt.active .wc-radio { border-color: #1F6F54; background: #1F6F54; }',
    '.wc-folder-opt .wc-fname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.wc-folder-opt .wc-count { font-size: 11px; color: #8A8378; }',
    '.wc-new-folder { display: flex; gap: 8px; margin: 4px 18px 6px; }',
    '.wc-new-folder input { flex: 1; pointer-events: auto; padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(43,42,38,.15); background: #fff; font-size: 13px; font-family: inherit; color: #2B2A26; outline: none; min-width: 0; }',
    '.wc-new-folder input:focus { border-color: #1F6F54; box-shadow: 0 0 0 3px rgba(31,111,84,.12); }',
    '.wc-new-folder button { pointer-events: auto; flex: none; display: flex; align-items: center; gap: 4px; padding: 8px 12px; border-radius: 8px; background: #E85D3F; color: #fff; font-size: 12.5px; font-weight: 600; }',
    '.wc-new-folder button:hover { background: #d14e31; }',

    '.wc-modal-foot { display: flex; gap: 10px; padding: 14px 18px 16px; margin-top: auto; }',
    '.wc-cancel { flex: 1; pointer-events: auto; padding: 10px; border-radius: 8px; background: transparent; border: 1px solid rgba(43,42,38,.2); color: #4a463f; font-size: 13.5px; font-family: inherit; cursor: pointer; }',
    '.wc-cancel:hover { background: rgba(43,42,38,.06); }',
    '.wc-confirm { flex: 2; pointer-events: auto; padding: 10px; border-radius: 8px; background: #1F6F54; color: #fff; border: none; font-size: 13.5px; font-weight: 600; font-family: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; }',
    '.wc-confirm:hover { background: #154E3B; }',
    '.wc-confirm:disabled { opacity: .5; cursor: default; }',

    /* toast */
    '.wc-toast { position: fixed; left: 50%; bottom: 36px; transform: translateX(-50%) translateY(20px); display: none; align-items: center; gap: 8px; background: #2B2A26; color: #FAF6EF; font-size: 13px; padding: 11px 18px; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.25); max-width: 80vw; }',
    '.wc-toast.show { display: flex; animation: wcToast .25s cubic-bezier(.2,.9,.3,1.2); }',
    '@keyframes wcToast { from { transform: translateX(-50%) translateY(20px); opacity: 0;} to { transform: translateX(-50%) translateY(0); opacity: 1;} }',
    '.wc-toast .wc-dot { width: 8px; height: 8px; border-radius: 50%; background: #E85D3F; flex: none; }',

    /* demo 管理抽屉 */
    '.wc-drawer-mask { position: fixed; inset: 0; background: rgba(43,42,38,.35); display: none; }',
    '.wc-drawer-mask.show { display: block; animation: wcFade .2s ease; }',
    '.wc-drawer { position: fixed; top: 0; right: 0; height: 100%; width: 380px; max-width: 92vw; background: #FAF6EF; box-shadow: -16px 0 48px rgba(43,42,38,.2); transform: translateX(105%); transition: transform .25s cubic-bezier(.2,.9,.3,1); display: flex; flex-direction: column; pointer-events: auto; }',
    '.wc-drawer.show { transform: none; }',
    '.wc-drawer-head { padding: 16px 18px 12px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(43,42,38,.08); }',
    '.wc-drawer-title { font-family: Georgia, "Songti SC", "Noto Serif SC", serif; font-size: 17px; font-weight: 700; }',
    '.wc-drawer-sub { font-size: 11px; color: #8A8378; margin-top: 2px; }',
    '.wc-chips { display: flex; gap: 6px; padding: 12px 14px 8px; overflow-x: auto; }',
    '.wc-chip { flex: none; pointer-events: auto; border: 1px solid rgba(43,42,38,.14); background: #fff; color: #4a463f; font-size: 12px; padding: 5px 12px; border-radius: 999px; font-family: inherit; cursor: pointer; }',
    '.wc-chip.active { background: #1F6F54; border-color: #1F6F54; color: #fff; }',
    '.wc-drawer-list { flex: 1; overflow-y: auto; padding: 6px 14px 20px; }',
    '.wc-card { background: #fff; border-radius: 10px; padding: 12px; margin-bottom: 10px; box-shadow: 0 2px 10px rgba(43,42,38,.07); border: 1px solid rgba(43,42,38,.05); }',
    '.wc-card-text { font-size: 13px; color: #3d3a34; line-height: 1.7; white-space: pre-wrap; word-break: break-word; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; border-left: 3px solid #E4EFE9; padding-left: 10px; }',
    '.wc-card img { width: 100%; max-height: 180px; object-fit: cover; border-radius: 8px; display: block; }',
    '.wc-card-foot { display: flex; align-items: center; gap: 8px; margin-top: 9px; font-size: 11px; color: #8A8378; }',
    '.wc-card-foot a { color: #1F6F54; text-decoration: none; display: inline-flex; align-items: center; gap: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px; }',
    '.wc-card-foot a:hover { text-decoration: underline; }',
    '.wc-card-del { margin-left: auto; pointer-events: auto; border: none; background: transparent; color: #b0a898; padding: 4px; border-radius: 6px; cursor: pointer; display: flex; }',
    '.wc-card-del:hover { color: #E85D3F; background: rgba(232,93,63,.08); }',
    '.wc-empty { text-align: center; color: #8A8378; font-size: 13px; padding: 60px 20px; line-height: 2; }',
    '.wc-empty .wc-eicon { color: #c8c0b2; margin-bottom: 8px; display: flex; justify-content: center; }',
  ].join('\n');

  var root = document.createElement('div');
  root.className = 'wc-root';
  root.innerHTML =
    '<style>' + STYLE + '</style>' +
    '<button class="wc-btn wc-text-btn" type="button">' + ICONS.bookmark + '<span>收藏</span></button>' +
    '<button class="wc-btn wc-img-badge" type="button" title="收藏此图片">' + ICONS.plus + '</button>' +
    '<div class="wc-fab-tip">拖到这里，收藏图片</div>' +
    '<button class="wc-btn wc-fab" type="button" title="网页收藏家">' + ICONS.bookmark + '</button>' +
    '<div class="wc-overlay">' +
      '<div class="wc-modal" role="dialog" aria-modal="true">' +
        '<div class="wc-modal-head"><div class="wc-modal-title">收藏到收藏册</div>' +
        '<button class="wc-btn wc-x wc-modal-cancel" type="button">' + ICONS.close + '</button></div>' +
        '<div class="wc-preview"></div>' +
        '<div class="wc-preview-meta"></div>' +
        '<div class="wc-sec-label">选择目录</div>' +
        '<div class="wc-folders"></div>' +
        '<div class="wc-new-folder"><input type="text" maxlength="40" placeholder="新建目录，如：设计灵感"/><button class="wc-btn" type="button">' + ICONS.plus + '新建</button></div>' +
        '<div class="wc-modal-foot"><button class="wc-btn wc-cancel" type="button">取消</button>' +
        '<button class="wc-btn wc-confirm" type="button">' + ICONS.check + '确认收藏</button></div>' +
      '</div>' +
    '</div>' +
    '<div class="wc-toast"><span class="wc-dot"></span><span class="wc-toast-msg"></span></div>' +
    '<div class="wc-drawer-mask"></div>' +
    '<div class="wc-drawer">' +
      '<div class="wc-drawer-head"><div><div class="wc-drawer-title">我的收藏册</div>' +
      '<div class="wc-drawer-sub">演示数据保存在本浏览器</div></div>' +
      '<button class="wc-btn wc-x wc-drawer-close" type="button">' + ICONS.close + '</button></div>' +
      '<div class="wc-chips"></div>' +
      '<div class="wc-drawer-list"></div>' +
    '</div>';

  shadow.appendChild(root);
  (document.documentElement || document.body).appendChild(host);

  function $(cls) { return root.querySelector(cls); }
  var elTextBtn = $('.wc-text-btn');
  var elBadge = $('.wc-img-badge');
  var elFab = $('.wc-fab');
  var elFabTip = $('.wc-fab-tip');
  var elOverlay = $('.wc-overlay');
  var elModal = $('.wc-modal');
  var elPreview = $('.wc-preview');
  var elPreviewMeta = $('.wc-preview-meta');
  var elFolders = $('.wc-folders');
  var elNewInput = $('.wc-new-folder input');
  var elNewBtn = $('.wc-new-folder button');
  var elConfirm = $('.wc-confirm');
  var elToast = $('.wc-toast');
  var elToastMsg = $('.wc-toast-msg');
  var elDrawerMask = $('.wc-drawer-mask');
  var elDrawer = $('.wc-drawer');
  var elChips = $('.wc-chips');
  var elDrawerList = $('.wc-drawer-list');

  /* ============================== 工具 ============================== */

  function isPathInOurUI(target) {
    if (!target) return false;
    // 兼容误传 Event 对象的情况
    var node = typeof target.addEventListener === 'function' ? target : target.target;
    if (!node || typeof node.nodeType !== 'number') return false;
    if (node === host || (root.contains && root.contains(node))) return true;
    if (typeof target.composedPath === 'function') {
      var path = target.composedPath();
      for (var i = 0; i < path.length; i++) if (path[i] === host || path[i] === root) return true;
    }
    return false;
  }

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function pageMeta() {
    var favicon = '';
    var link = document.querySelector('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
    if (link && link.href) favicon = link.href;
    return { pageUrl: location.href, pageTitle: document.title || location.hostname, favicon: favicon };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  var toastTimer = null;
  function toast(msg) {
    elToastMsg.textContent = msg;
    elToast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { elToast.classList.remove('show'); }, 2600);
  }

  /* ============================== 划词收藏按钮 ============================== */

  function hideTextBtn() {
    elTextBtn.classList.remove('show');
  }

  function showTextBtn(rect, text) {
    elTextBtn.dataset.text = text;
    elTextBtn.classList.add('show');
    var bw = elTextBtn.offsetWidth || 92;
    var top = rect.bottom + 10;
    var left = rect.left + rect.width / 2 - bw / 2;
    if (top + 40 > window.innerHeight) top = rect.top - 42;
    left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
    elTextBtn.style.top = top + 'px';
    elTextBtn.style.left = left + 'px';
  }

  document.addEventListener(
    'mouseup',
    function (e) {
      if (isPathInOurUI(e) || modalOpen) return;
      setTimeout(function () {
        var sel = window.getSelection();
        var text = sel ? String(sel.toString() || '') : '';
        if (!text || !text.trim()) { hideTextBtn(); return; }
        if (isEditable(e.target)) { hideTextBtn(); return; }
        if (!sel.rangeCount) { hideTextBtn(); return; }
        var rect = sel.getRangeAt(0).getBoundingClientRect();
        if (!rect || (!rect.width && !rect.height)) { hideTextBtn(); return; }
        showTextBtn(rect, text.trim().slice(0, 5000));
      }, 0);
    },
    true
  );

  elTextBtn.addEventListener('click', function () {
    var text = elTextBtn.dataset.text;
    hideTextBtn();
    if (text) openCollector({ kind: 'text', text: text });
  });

  /* ============================== 图片悬停角标 ============================== */

  var badgeImg = null;
  var badgeRaf = 0;

  function hideBadge() {
    elBadge.classList.remove('show');
    badgeImg = null;
  }

  function positionBadge() {
    if (!badgeImg) return;
    var r = badgeImg.getBoundingClientRect();
    elBadge.style.top = Math.max(6, r.top + 8) + 'px';
    elBadge.style.left = Math.min(window.innerWidth - 44, r.right - 42) + 'px';
  }

  document.addEventListener(
    'mouseover',
    function (e) {
      if (modalOpen) return;
      if (isPathInOurUI(e)) return;
      var img = e.target && e.target.nodeType === 1 && e.target.tagName === 'IMG' ? e.target : null;
      if (img === badgeImg) return;
      if (!img) { hideBadge(); return; }
      var r = img.getBoundingClientRect();
      if (r.width < 90 || r.height < 90) { hideBadge(); return; }
      var src = img.currentSrc || img.src;
      if (!src) { hideBadge(); return; }
      badgeImg = img;
      elBadge.dataset.src = src;
      elBadge.dataset.alt = img.alt || '';
      elBadge.classList.add('show');
      cancelAnimationFrame(badgeRaf);
      badgeRaf = requestAnimationFrame(positionBadge);
    },
    true
  );

  elBadge.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    var src = elBadge.dataset.src;
    var alt = elBadge.dataset.alt;
    hideBadge();
    if (src) openCollector({ kind: 'image', imageUrl: src, alt: alt });
  });

  window.addEventListener('scroll', function () { hideTextBtn(); hideBadge(); }, true);
  window.addEventListener('resize', function () { hideTextBtn(); hideBadge(); });

  /* ============================== 拖拽投放 ============================== */

  var dragPayload = null;

  function clearDrag() {
    dragPayload = null;
    elFab.classList.remove('drop-ready', 'drop-active');
    elFabTip.classList.remove('show');
  }

  document.addEventListener('dragstart', function (e) {
    if (modalOpen || isPathInOurUI(e)) return;
    var img = e.target && e.target.nodeType === 1 && e.target.tagName === 'IMG' ? e.target : null;
    if (img) {
      var r = img.getBoundingClientRect();
      if (r.width < 60 || r.height < 60) return;
      dragPayload = { kind: 'image', imageUrl: img.currentSrc || img.src, alt: img.alt || '' };
      elFab.classList.add('drop-ready');
      elFabTip.classList.add('show');
    }
  });

  document.addEventListener('dragend', clearDrag);
  elFab.addEventListener('dragover', function (e) {
    if (!dragPayload) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    elFab.classList.add('drop-active');
  });
  elFab.addEventListener('dragleave', function () { elFab.classList.remove('drop-active'); });
  elFab.addEventListener('drop', function (e) {
    e.preventDefault();
    e.stopPropagation();
    var p = dragPayload;
    clearDrag();
    if (p) openCollector(p);
  });

  /* FAB 点击：扩展环境尝试打开 popup；演示环境打开管理抽屉 */
  elFab.addEventListener('click', function () {
    if (api.isDemo) {
      openDrawer();
    } else {
      api.openManager().then(function (ok) {
        if (!ok) toast('请点击浏览器右上角的扩展图标，查看收藏册');
      });
    }
  });

  /* ============================== 目录选择模态 ============================== */

  var modalOpen = false;
  var currentPayload = null;
  var folders = [];
  var selectedFolderId = null;

  function renderPreview(p) {
    if (p.kind === 'text') {
      elPreview.innerHTML = '';
      elPreview.textContent = p.text.length > 400 ? p.text.slice(0, 400) + '…' : p.text;
      elPreviewMeta.innerHTML = ICONS.text + '<span>文字片段 · ' + p.text.length + ' 字</span>';
    } else {
      elPreview.innerHTML = '<img src="' + esc(p.imageUrl) + '" alt="">';
      elPreviewMeta.innerHTML = ICONS.image + '<span>图片</span>';
    }
  }

  function folderName(id) {
    if (!id) return '未分类';
    var f = folders.filter(function (x) { return x.id === id; })[0];
    return f ? f.name : '未分类';
  }

  function renderFolders() {
    var html =
      '<button class="wc-folder-opt' + (selectedFolderId === null ? ' active' : '') + '" data-id="" type="button">' +
      '<span class="wc-radio">' + (selectedFolderId === null ? ICONS.check : '') + '</span>' +
      ICONS.folder + '<span class="wc-fname">未分类</span></button>';
    folders.forEach(function (f) {
      html +=
        '<button class="wc-folder-opt' + (selectedFolderId === f.id ? ' active' : '') + '" data-id="' + esc(f.id) + '" type="button">' +
        '<span class="wc-radio">' + (selectedFolderId === f.id ? ICONS.check : '') + '</span>' +
        ICONS.folder + '<span class="wc-fname">' + esc(f.name) + '</span></button>';
    });
    elFolders.innerHTML = html;
    Array.prototype.forEach.call(elFolders.querySelectorAll('.wc-folder-opt'), function (btn) {
      btn.addEventListener('click', function () {
        selectedFolderId = btn.dataset.id || null;
        renderFolders();
      });
    });
  }

  function openCollector(payload) {
    currentPayload = payload;
    modalOpen = true;
    hideTextBtn();
    hideBadge();
    renderPreview(payload);
    elOverlay.classList.add('show');
    api.listFolders().then(function (fs) {
      folders = fs || [];
      return api.getLastFolder();
    }).then(function (last) {
      selectedFolderId = last && folders.some(function (f) { return f.id === last; }) ? last : null;
      renderFolders();
    });
  }

  function closeCollector() {
    modalOpen = false;
    currentPayload = null;
    elOverlay.classList.remove('show');
    elNewInput.value = '';
  }

  elNewBtn.addEventListener('click', function () {
    var name = elNewInput.value.trim();
    if (!name) { elNewInput.focus(); return; }
    elNewBtn.disabled = true;
    api.createFolder(name).then(function (f) {
      elNewBtn.disabled = false;
      if (f) {
        folders.push(f);
        selectedFolderId = f.id;
        elNewInput.value = '';
        renderFolders();
      }
    });
  });
  elNewInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') elNewBtn.click();
  });

  elConfirm.addEventListener('click', function () {
    if (!currentPayload || elConfirm.disabled) return;
    elConfirm.disabled = true;
    var payload = Object.assign({}, currentPayload, pageMeta(), { folderId: selectedFolderId });
    api
      .saveItem(payload)
      .then(function (r) {
        elConfirm.disabled = false;
        if (r && r.ok) {
          api.setLastFolder(selectedFolderId);
          var name = folderName(selectedFolderId);
          toast(r.degraded ? '已收藏到「' + name + '」（原图受站点保护，将以原地址展示）' : '已收藏到「' + name + '」');
          closeCollector();
        } else {
          toast((r && r.error) || '收藏失败，请重试');
        }
      })
      .catch(function () {
        elConfirm.disabled = false;
        toast('收藏失败：扩展连接已失效，请刷新页面后重试');
      });
  });

  $('.wc-modal-cancel').addEventListener('click', closeCollector);
  $('.wc-cancel').addEventListener('click', closeCollector);
  elOverlay.addEventListener('click', function (e) {
    if (e.target === elOverlay) closeCollector();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modalOpen) closeCollector();
  });

  /* ============================== demo 管理抽屉 ============================== */

  var drawerFolderFilter = '__all__';

  function openDrawer() {
    elDrawerMask.classList.add('show');
    elDrawer.classList.add('show');
    refreshDrawer();
  }
  function closeDrawer() {
    elDrawerMask.classList.remove('show');
    elDrawer.classList.remove('show');
  }
  $('.wc-drawer-close').addEventListener('click', closeDrawer);
  elDrawerMask.addEventListener('click', closeDrawer);

  function refreshDrawer() {
    api.listFolders().then(function (fs) {
      folders = fs || [];
      var chips = '<button class="wc-chip' + (drawerFolderFilter === '__all__' ? ' active' : '') + '" data-f="__all__">全部</button>' +
        '<button class="wc-chip' + (drawerFolderFilter === '' ? ' active' : '') + '" data-f="">未分类</button>';
      folders.forEach(function (f) {
        chips += '<button class="wc-chip' + (drawerFolderFilter === f.id ? ' active' : '') + '" data-f="' + esc(f.id) + '">' + esc(f.name) + '</button>';
      });
      elChips.innerHTML = chips;
      Array.prototype.forEach.call(elChips.querySelectorAll('.wc-chip'), function (c) {
        c.addEventListener('click', function () {
          drawerFolderFilter = c.dataset.f;
          refreshDrawer();
        });
      });
      var opt = {};
      if (drawerFolderFilter !== '__all__') opt.folderId = drawerFolderFilter === '' ? null : drawerFolderFilter;
      return api.listItems(opt);
    }).then(function (items) {
      if (!items.length) {
        elDrawerList.innerHTML =
          '<div class="wc-empty"><div class="wc-eicon">' + ICONS.bookmark + '</div>还没有收藏内容<br>在网页上划选文字或悬停图片，点击收藏按钮试试</div>';
        return;
      }
      elDrawerList.innerHTML = items
        .map(function (it) {
          var body =
            it.type === 'image'
              ? '<img src="' + esc(it.imageUrl || '') + '" alt="">'
              : '<div class="wc-card-text">' + esc(it.text || '') + '</div>';
          var link = it.pageUrl
            ? '<a href="' + esc(it.pageUrl) + '" target="_blank" rel="noopener">' + ICONS.external + esc(it.pageTitle || it.pageUrl) + '</a>'
            : '';
          return (
            '<div class="wc-card" data-id="' + esc(it.id) + '">' +
            body +
            '<div class="wc-card-foot">' +
            (it.folderId ? ICONS.folder : '') + '<span>' + esc(it.folderId ? folderName(it.folderId) : '未分类') + ' · ' + fmtTime(it.createdAt) + '</span>' +
            link +
            '<button class="wc-card-del" type="button" title="删除">' + ICONS.trash + '</button>' +
            '</div></div>'
          );
        })
        .join('');
      Array.prototype.forEach.call(elDrawerList.querySelectorAll('.wc-card-del'), function (btn) {
        btn.addEventListener('click', function () {
          var card = btn.closest('.wc-card');
          var id = card && card.dataset.id;
          if (!id) return;
          api.deleteItem(id).then(refreshDrawer);
        });
      });
    });
  }

  /* ============================== 右键菜单消息（扩展环境） ============================== */

  if (HAS_CHROME && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (!msg || msg.type !== 'WC_TRIGGER_COLLECT') return;
      if (msg.kind === 'image' && msg.imageUrl) {
        openCollector({ kind: 'image', imageUrl: msg.imageUrl, alt: '' });
      } else if (msg.kind === 'selection') {
        var text = String((window.getSelection && window.getSelection().toString()) || '').trim();
        if (text) openCollector({ kind: 'text', text: text.slice(0, 5000) });
        else toast('请先在网页上选中要收藏的文字');
      }
    });
  }
})();
