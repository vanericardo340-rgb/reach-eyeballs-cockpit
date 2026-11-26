// Cockpit for macOS: a native window around https://reach-eyeballs-cockpit.vercel.app
// - stays signed in (persistent session), remembers its size and position
// - links to other sites (Google Docs, Sheets, Miro, ClickUp…) open in your browser
// - Cockpit pages opened from the app (e.g. Weight / EOD overviews) open in app windows
const { app, BrowserWindow, Menu, shell, nativeTheme } = require("electron");
const path = require("path");
const fs = require("fs");

const START = "https://reach-eyeballs-cockpit.vercel.app/";
const ORIGIN = new URL(START).origin;
const statePath = () => path.join(app.getPath("userData"), "window-state.json");

function loadState() {
  try { return JSON.parse(fs.readFileSync(statePath(), "utf8")); } catch { return { width: 1400, height: 900 }; }
}
function saveState(win) {
  try {
    if (win.isDestroyed() || win.isMinimized()) return;
    fs.writeFileSync(statePath(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch {}
}

const isCockpit = (url) => { try { return new URL(url).origin === ORIGIN; } catch { return false; } };

function wire(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isCockpit(url)) {
      return { action: "allow", overrideBrowserWindowOptions: { width: 1200, height: 860, backgroundColor: "#ffffff", webPreferences: { partition: "persist:cockpit" } } };
    }
    if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("did-create-window", (child) => wire(child));
  // Plain link clicks that would leave the Cockpit go to the browser instead.
  win.webContents.on("will-navigate", (e, url) => {
    if (!isCockpit(url)) { e.preventDefault(); if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url); }
  });
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMain) => {
    if (isMain && code !== -3) win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(offlinePage())}`);
  });
}

function offlinePage() {
  return `<!doctype html><meta charset="utf-8"><title>Cockpit</title><style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font:15px -apple-system,BlinkMacSystemFont,sans-serif;background:#f6f4fb;color:#17161f;text-align:center}.m{width:64px;height:64px;margin:0 auto 16px;border-radius:16px;background:linear-gradient(135deg,#6c4fe0,#e0883e);color:#fff;font-weight:800;font-size:24px;display:flex;align-items:center;justify-content:center}p{color:#57565f}button{border:0;border-radius:12px;background:#6c4fe0;color:#fff;font-weight:600;padding:10px 18px;font-size:14px;cursor:pointer}</style><div><div class="m">RE</div><h2>Can’t reach the Cockpit</h2><p>Check your internet connection, then try again.</p><button onclick="location.href='${START}'">Try again</button></div>`;
}

function createWindow() {
  const s = loadState();
  const win = new BrowserWindow({
    x: s.x, y: s.y, width: s.width || 1400, height: s.height || 900,
    minWidth: 380, minHeight: 500,
    title: "Cockpit",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0b0b10" : "#ffffff",
    show: false,
    webPreferences: { partition: "persist:cockpit", spellcheck: true },
  });
  if (s.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());
  ["resize", "move", "close"].forEach((ev) => win.on(ev, () => saveState(win)));
  wire(win);
  win.loadURL(START);
  return win;
}

function buildMenu() {
  const template = [
    { role: "appMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: (_i, w) => w && w.webContents.reload() },
        { label: "Go to Today", accelerator: "CmdOrCtrl+Shift+H", click: (_i, w) => w && w.loadURL(START) },
        { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Navigate",
      submenu: [
        { label: "Back", accelerator: "CmdOrCtrl+[", click: (_i, w) => w && w.webContents.navigationHistory.canGoBack() && w.webContents.navigationHistory.goBack() },
        { label: "Forward", accelerator: "CmdOrCtrl+]", click: (_i, w) => w && w.webContents.navigationHistory.canGoForward() && w.webContents.navigationHistory.goForward() },
        { type: "separator" },
        { label: "Open in Browser", accelerator: "CmdOrCtrl+Shift+O", click: (_i, w) => shell.openExternal(w ? w.webContents.getURL() : START) },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(() => { buildMenu(); createWindow(); });
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
