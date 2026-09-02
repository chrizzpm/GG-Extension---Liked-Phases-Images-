# AGENTS.md — 网页收藏家 Web Collector

## 项目概览

「网页收藏家」是一款 **Chrome / Edge 浏览器扩展（Manifest V3）**，用于把网页上的**文字与图片**快速收藏到用户自建的分类目录中。本仓库同时包含：

1. **扩展本体**（`extension/` 目录，可直接加载到 Chrome）
2. **产品落地页 + 在线演示**（根目录 `index.html` + `styles/landing.css`，托管于静态服务器）
3. **扩展下载包**（`web-collector-extension.zip`，由 `extension/` 打包生成）

设计风格（米纸底 + 墨绿主色 + 朱砂点缀的「手账剪报册」质感）详见 `DESIGN.md`。

## 目录结构

```
.
├── index.html                     # 落地页（产品介绍 / 在线演示 / 安装指南）
├── styles/landing.css             # 落地页样式
├── server.py                      # 静态服务器（强制 no-store 响应头，禁缓存）
├── images/demo-1.jpg, demo-2.jpg  # 落地页演示配图
├── web-collector-extension.zip    # 扩展发布包（打包脚本见下方）
└── extension/                     # ★ Chrome 扩展本体（MV3）
    ├── manifest.json
    ├── background/service-worker.js  # 消息路由 / 跨域抓图 / 右键菜单
    ├── common/db.js                  # IndexedDB 数据层（ES module，SW 与 popup 共用）
    ├── content/content.js            # content script：采集 UI（Shadow DOM 隔离）
    ├── popup/popup.html / .css / .js # 工具栏弹窗：收藏管理界面
    └── icons/icon16.png / 48 / 128
```

## 技术架构

- **Manifest V3**，无构建步骤，原生 JS。
- **content script**（`content/content.js`，非模块 IIFE）：
  - 全部 UI 注入 **Shadow DOM**（`attachShadow({mode:'closed'})`），与宿主页面样式完全隔离。
  - 三种采集方式：① 划选文字后选区旁浮现「收藏」按钮；② 悬停图片（≥90px）显示圆形收藏角标；③ 拖拽图片到右下角悬浮球投放。另支持扩展右键菜单。
  - 目录选择模态：选择/新建目录 → 发送 `SAVE_ITEM` 消息 → toast 反馈。
  - **双运行模式**：检测到 `chrome.runtime.sendMessage` 走扩展消息通道；否则（落地页演示）切换 localStorage 适配器，同一份代码可直接在官网演示，演示模式下悬浮球点击打开「我的收藏册」抽屉。
- **service worker**（`background/service-worker.js`，`"type":"module"`）：
  - 消息路由（文件夹 CRUD、收藏读写、导入导出、`OPEN_POPUP`）。
  - 图片抓取：凭 `host_permissions: <all_urls>` 在 SW 中跨域 fetch 图片为 Blob（15s 超时）；失败降级为仅存原图 URL，popup 用 `referrerpolicy="no-referrer"` 兜底展示。
  - 注册 `contextMenus`（selection / image），通过 `tabs.sendMessage` 触发 content 收藏流程。
- **数据层**（`common/db.js`）：IndexedDB（`web-collector-db`），`folders` 与 `items` 两个 store；图片以 Blob 存储；删除目录时其下条目归入「未分类」；支持 JSON 备份导出/导入（图片转 dataURL）。SW 与 popup 同属扩展 origin，直接共享同一份模块。
- **popup**：左侧目录栏（全部/未分类/自建目录，支持重命名、删除、新建）+ 右侧卡片流（全文搜索、复制文字、下载图片、删除、来源链接、favicon）。

## 构建与运行

- 本地预览：静态服务器读取 `DEPLOY_RUN_PORT` 环境变量（`.coze` 中 `run = ["python server.py"]`，切勿改回数组形式多命令，会被 CLI 多层 `sh -c` 包裹导致服务起不来）。
- 扩展无需构建；修改 `extension/` 后在 `chrome://extensions` 点击扩展卡片的「重新加载」即可生效。
- 重新打包发布 zip：
  ```bash
  python3 -c "
  import zipfile, os
  out='web-collector-extension.zip'
  if os.path.exists(out): os.remove(out)
  with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
      for r,_,fs in os.walk('extension'):
          for f in fs: z.write(os.path.join(r,f), os.path.relpath(os.path.join(r,f),'extension'))"
  ```

## 代码风格与约定

- 原生 ES 语法；`content.js` 为非模块脚本（IIFE + `var`），`service-worker.js / db.js / popup.js` 为 ES module。
- UI 颜色/动效遵循 `DESIGN.md` Design Tokens；功能图标一律内联 SVG，禁止 emoji 作功能图标；禁止远程字体/CDN 依赖进入扩展。
- content script 事件监听用 capture 阶段 + `composedPath()` 判断，避免在自有 UI 内触发宿主逻辑；编辑区（input/textarea/contenteditable）内不显示采集按钮。

## 验证

- JS 语法检查：`node --check extension/content/content.js`；module 文件用 `node --input-type=module --check < file`。
- manifest 校验：`python3 -c "import json; json.load(open('extension/manifest.json'))"`。
- 页面/资源探活通过 `test_run` 执行（落地页、`extension/**` 各资源、zip 均应 200）。
- 浏览器端冒烟：落地页直接划词/悬停图片/拖拽图片到悬浮球/新建目录/打开收藏抽屉；扩展环境在 `chrome://extensions` 加载 `extension/` 后于任意网页重复上述流程，并通过工具栏图标管理收藏。
