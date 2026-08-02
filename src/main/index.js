const path = require("node:path");
const fs = require("node:fs/promises");
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { RouletteEngine } = require("./engine");
const { JsonStore } = require("./store");
const { OverlayServer } = require("./overlay-server");
const { ChzzkClient } = require("./chzzk-client");
const { scanSteamLibraries } = require("./steam-library");
const { fetchOwnedGames } = require("./steam-web-api");
const { createSpinAnimation } = require("./wheel-of-names-client");
const { UpdateService } = require("./update-service");
const { isValidLocation } = require("./sunrise");
const { getWindowsLocation } = require("./windows-location");
const { createGameBackup, parseGameBackup } = require("./game-backup");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let mainWindow;
let store;
let engine;
let overlayServer;
let chzzk;
let saveTimer;
let spinTimer;
let autoSpinTimer;
let updateService;
let updateCheckTimer;
let tickInterval;
let sunriseInterval;
let spinInFlight = false;

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

function sendWheelStatus(phase, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("wheel:status", { phase, message });
  }
}

async function beginConfiguredSpin() {
  if (spinInFlight) throw new Error("룰렛 결과를 이미 생성하고 있습니다.");
  spinInFlight = true;
  try {
    if (engine.settings.wheelProvider !== "wheelofnames") {
      return engine.beginSpin({ provider: "local" });
    }
    const context = engine.prepareSpin();
    try {
      sendWheelStatus("generating", "Wheel of Names 회전 영상을 만드는 중입니다…");
      const secrets = store.readSecrets();
      const generated = await createSpinAnimation({
        apiKey: secrets.wheelOfNamesApiKey,
        context
      });
      const animationVersion = `${Date.now()}`;
      overlayServer.setWheelAnimation({
        version: animationVersion,
        data: generated.animation,
        contentType: generated.contentType
      });
      sendWheelStatus("connected", "Wheel of Names 연결됨");
      return engine.beginPreparedSpin(context, generated.winnerId, {
        provider: "wheelofnames",
        animationVersion
      });
    } catch (error) {
      sendWheelStatus("fallback", `${error.message} 기존 로컬 룰렛으로 진행합니다.`);
      return engine.beginSpin({ provider: "local", fallbackReason: error.message });
    }
  } finally {
    spinInFlight = false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#0c1017",
    title: "랜덤룰렛게임데이",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

function installIpcHandlers() {
  ipcMain.handle("state:get", () => engine.snapshot());
  ipcMain.handle("secrets:summary", () => {
    const secrets = store.readSecrets();
    return {
      hasCredentials: Boolean(secrets.clientId && secrets.clientSecret),
      clientId: secrets.clientId || "",
      hasSteamApiKey: Boolean(secrets.steamApiKey),
      steamProfile: secrets.steamProfile || "",
      hasWheelOfNamesApiKey: Boolean(secrets.wheelOfNamesApiKey)
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
        if (Object.hasOwn(payload, "sunriseEnabled")) {
          const secrets = store.readSecrets();
          if (payload.sunriseEnabled) {
            const latitude = Number(payload.sunriseLatitude);
            const longitude = Number(payload.sunriseLongitude);
            if (!isValidLocation(latitude, longitude)) throw new Error("현재 위치를 확인하지 못했습니다.");
            store.writeSecrets({
              ...secrets,
              sunriseLocation: { latitude, longitude }
            });
          } else {
            delete secrets.sunriseLocation;
            store.writeSecrets(secrets);
          }
        }
        engine.updateSettings(payload);
        if (payload.updateChannel) updateService.setChannel(engine.settings.updateChannel);
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
      case "game:remove-many": {
        const removed = engine.removeGames(payload.ids);
        return { removed };
      }
      case "game:clear": {
        const removed = engine.clearGames();
        return { removed };
      }
      case "game:backup": {
        const result = await dialog.showSaveDialog(mainWindow, {
          title: "룰렛 게임 목록 백업",
          defaultPath: `roulette-games-${new Date().toISOString().slice(0, 10)}.json`,
          filters: [{ name: "JSON 백업", extensions: ["json"] }]
        });
        if (result.canceled || !result.filePath) return { canceled: true };
        const backup = createGameBackup(engine.games);
        await fs.writeFile(result.filePath, JSON.stringify(backup, null, 2), "utf8");
        return { canceled: false, count: backup.games.length, filePath: result.filePath };
      }
      case "game:restore": {
        const result = await dialog.showOpenDialog(mainWindow, {
          title: "룰렛 게임 목록 백업 불러오기",
          properties: ["openFile"],
          filters: [{ name: "JSON 백업", extensions: ["json"] }]
        });
        if (result.canceled || !result.filePaths[0]) return { canceled: true };
        const games = parseGameBackup(await fs.readFile(result.filePaths[0], "utf8"));
        const imported = engine.replaceGames(games);
        return { canceled: false, imported, filePath: result.filePaths[0] };
      }
      case "steam:scan": {
        const games = scanSteamLibraries();
        const result = engine.mergeGames(games);
        return { ...result, found: games.length };
      }
      case "steam:web-import": {
        const secrets = store.readSecrets();
        const apiKey = String(payload?.apiKey || secrets.steamApiKey || "").trim();
        const profile = String(payload?.profile || secrets.steamProfile || "").trim();
        const imported = await fetchOwnedGames({ apiKey, profile });
        store.writeSecrets({
          ...secrets,
          steamApiKey: apiKey,
          steamProfile: profile
        });
        const result = engine.mergeGames(imported.games, "steam-web");
        return { ...result, found: imported.games.length, steamId: imported.steamId };
      }
      case "steam:key-page":
        await shell.openExternal("https://steamcommunity.com/dev/apikey");
        return { ok: true };
      case "steam:privacy-page":
        await shell.openExternal("https://steamcommunity.com/my/edit/settings");
        return { ok: true };
      case "wheel:settings": {
        const secrets = store.readSecrets();
        const apiKey = String(payload?.apiKey || secrets.wheelOfNamesApiKey || "").trim();
        const provider = payload?.provider === "wheelofnames" ? "wheelofnames" : "local";
        if (provider === "wheelofnames" && !apiKey) {
          throw new Error("Wheel of Names API 키를 먼저 입력해 주세요.");
        }
        if (payload?.apiKey) {
          store.writeSecrets({ ...secrets, wheelOfNamesApiKey: apiKey });
        }
        engine.updateSettings({ wheelProvider: provider });
        sendWheelStatus(
          provider === "wheelofnames" ? "connected" : "local",
          provider === "wheelofnames" ? "Wheel of Names 사용 준비됨" : "기존 로컬 룰렛 사용 중"
        );
        return { provider, hasApiKey: Boolean(apiKey) };
      }
      case "request:resolve":
        engine.resolveRequest(payload.id, payload.decision, payload.gameName);
        return engine.snapshot();
      case "spin": {
        const spin = await beginConfiguredSpin();
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
      case "sound:test":
        engine.triggerCue(payload.type);
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
  ipcMain.handle("update:get-status", () => updateService.snapshot());
  ipcMain.handle("update:check", () => updateService.check());
  ipcMain.handle("update:download", () => updateService.download());
  ipcMain.handle("update:install", () => updateService.install());
  ipcMain.handle("update:open", () => updateService.openRelease());
  ipcMain.handle("location:current", () => getWindowsLocation());
}

app.whenReady().then(async () => {
  store = new JsonStore(app.getPath("userData"));
  const savedState = store.readState();
  const savedSecrets = store.readSecrets();
  if (savedState.settings?.sunriseEnabled && savedSecrets.sunriseLocation) {
    savedState.settings.sunriseLatitude = savedSecrets.sunriseLocation.latitude;
    savedState.settings.sunriseLongitude = savedSecrets.sunriseLocation.longitude;
  } else if (savedState.settings?.sunriseEnabled) {
    savedState.settings.sunriseEnabled = false;
  }
  if (!savedState.settings?.updateChannel && app.getVersion().includes("-")) {
    savedState.settings = { ...(savedState.settings || {}), updateChannel: "beta" };
  }
  engine = new RouletteEngine(savedState);
  updateService = new UpdateService({
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    isPortable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR),
    updater: autoUpdater,
    openExternal: (url) => shell.openExternal(url)
  });
  updateService.setChannel(engine.settings.updateChannel);
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
      autoSpinTimer = setTimeout(async () => {
        try {
          const spin = await beginConfiguredSpin();
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
  updateService.on("status", (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("update:status", status);
  });
  overlayServer.on("oauth-callback", (payload) => {
    chzzk.handleCallback(payload).catch((error) => chzzk.setStatus("error", error.message));
  });

  installIpcHandlers();
  createWindow();
  updateCheckTimer = setTimeout(() => updateService.check(), 12000);
  tickInterval = setInterval(() => engine.tick(), 250);
  sunriseInterval = setInterval(() => {
    if (engine.settings.sunriseEnabled) sendState();
  }, 1000);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  clearTimeout(saveTimer);
  clearTimeout(spinTimer);
  clearTimeout(autoSpinTimer);
  clearTimeout(updateCheckTimer);
  clearInterval(tickInterval);
  clearInterval(sunriseInterval);
  if (store && engine) store.writeState(engine.persistentSnapshot());
  if (chzzk) chzzk.disconnect();
  if (overlayServer) overlayServer.close();
});
