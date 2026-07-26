const path = require("node:path");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { RouletteEngine } = require("./engine");
const { JsonStore } = require("./store");
const { OverlayServer } = require("./overlay-server");
const { ChzzkClient } = require("./chzzk-client");
const { scanSteamLibraries } = require("./steam-library");

let mainWindow;
let store;
let engine;
let overlayServer;
let chzzk;
let saveTimer;
let spinTimer;
let autoSpinTimer;

function sendState(state = engine.snapshot()) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("state", state);
  if (overlayServer) overlayServer.broadcast(state);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.writeState(engine.persistentSnapshot()), 250);
}

function scheduleSpinFinalize(spin) {
  clearTimeout(spinTimer);
  spinTimer = setTimeout(() => engine.finalizeSpin(spin.id), 6500);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#0c1017",
    title: "랜덤룰렛게임데이",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

function installIpcHandlers() {
  ipcMain.handle("state:get", () => engine.snapshot());
  ipcMain.handle("secrets:summary", () => {
    const secrets = store.readSecrets();
    return {
      hasCredentials: Boolean(secrets.clientId && secrets.clientSecret),
      clientId: secrets.clientId || ""
    };
  });
  ipcMain.handle("chzzk:authorize", (_event, credentials) => {
    const current = store.readSecrets();
    store.writeSecrets({ ...current, ...credentials, tokens: current.tokens || null });
    chzzk.beginAuthorization(credentials);
    return { ok: true };
  });
  ipcMain.handle("chzzk:reconnect", async () => {
    const secrets = store.readSecrets();
    if (!secrets.clientId || !secrets.clientSecret || !secrets.tokens) {
      throw new Error("저장된 치지직 인증이 없습니다.");
    }
    chzzk.restore(
      { clientId: secrets.clientId, clientSecret: secrets.clientSecret },
      secrets.tokens
    );
    await chzzk.connectSession();
    return { ok: true };
  });
  ipcMain.handle("command", async (_event, { name, payload }) => {
    switch (name) {
      case "settings:update":
        engine.updateSettings(payload);
        return engine.snapshot();
      case "game:add":
        engine.addGame(payload.name, { slots: payload.slots, source: "manual" });
        return engine.snapshot();
      case "game:update":
        engine.updateGame(payload.id, payload.patch);
        return engine.snapshot();
      case "game:remove":
        engine.removeGame(payload.id);
        return engine.snapshot();
      case "steam:scan": {
        const games = scanSteamLibraries();
        const result = engine.mergeGames(games);
        return { ...result, found: games.length };
      }
      case "request:resolve":
        engine.resolveRequest(payload.id, payload.decision, payload.gameName);
        return engine.snapshot();
      case "spin": {
        const spin = engine.beginSpin();
        scheduleSpinFinalize(spin);
        return spin;
      }
      case "timer:start":
        engine.startTimer();
        return engine.snapshot();
      case "timer:pause":
        engine.pauseTimer();
        return engine.snapshot();
      case "timer:reset":
        engine.resetTimer();
        return engine.snapshot();
      case "game:finish":
        engine.finishGameEarly();
        return engine.snapshot();
      case "event:reset":
        engine.resetEvent();
        return engine.snapshot();
      case "donation:simulate":
        return engine.ingestDonation(payload);
      case "overlay:open":
        shell.openExternal(`http://127.0.0.1:${engine.settings.overlayPort}/overlay/`);
        return { ok: true };
      default:
        throw new Error(`알 수 없는 명령: ${name}`);
    }
  });
}

app.whenReady().then(async () => {
  store = new JsonStore(app.getPath("userData"));
  engine = new RouletteEngine(store.readState());
  overlayServer = new OverlayServer({
    directory: path.join(__dirname, "..", "overlay"),
    port: engine.settings.overlayPort,
    getState: () => engine.snapshot()
  });
  await overlayServer.start();
  chzzk = new ChzzkClient({
    redirectUri: `http://127.0.0.1:${engine.settings.overlayPort}/oauth/callback`,
    openExternal: (url) => shell.openExternal(url)
  });

  engine.on("change", (state) => {
    sendState(state);
    scheduleSave();
    clearTimeout(autoSpinTimer);
    if (state.status === "awaiting_spin" && state.settings.mode === "auto") {
      autoSpinTimer = setTimeout(() => {
        try {
          const spin = engine.beginSpin();
          scheduleSpinFinalize(spin);
        } catch (error) {
          chzzk.setStatus("error", `자동 룰렛 실패: ${error.message}`);
        }
      }, 2500);
    }
  });
  chzzk.on("status", (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("chzzk:status", status);
    }
  });
  chzzk.on("tokens", (tokens) => {
    const secrets = store.readSecrets();
    store.writeSecrets({ ...secrets, tokens });
  });
  chzzk.on("donation", (donation) => engine.ingestDonation(donation));
  overlayServer.on("oauth-callback", (payload) => {
    chzzk.handleCallback(payload).catch((error) => chzzk.setStatus("error", error.message));
  });

  installIpcHandlers();
  createWindow();
  setInterval(() => engine.tick(), 250);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  clearTimeout(saveTimer);
  clearTimeout(spinTimer);
  clearTimeout(autoSpinTimer);
  if (store && engine) store.writeState(engine.persistentSnapshot());
  if (chzzk) chzzk.disconnect();
  if (overlayServer) overlayServer.close();
});
