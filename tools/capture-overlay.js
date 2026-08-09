const fs = require("node:fs/promises");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const { OverlayServer } = require("../src/main/overlay-server");

const outputPath = path.resolve(process.argv[2] || path.join("artifacts", "overlay-wheel.png"));
const games = [
  ["디맥 리스펙트 V", 60], ["마녀재판", 5], ["쇼타임", 10], ["점프왕", 3],
  ["한스", 20], ["A게임", 1], ["B게임", 1], ["C게임", 1], ["D게임", 1]
].map(([name, slots], index) => ({ id: `game-${index}`, name, slots, enabled: true }));

const state = {
  status: "spinning",
  round: 4,
  currentGame: null,
  games,
  settings: {
    nextRoundPreviewEnabled: true,
    soundOutput: "off",
    soundVolume: 0,
    roundDurationSec: 1800,
    endChanceStart: 5
  },
  timer: { running: false, remainingSec: 1800 },
  probability: { round: 4, endChance: 5, gamesChance: 95 },
  sunrise: { enabled: false },
  spin: {
    id: "visual-check",
    provider: "local",
    round: 4,
    chanceUsed: 5,
    games,
    resultType: "game",
    resultId: "game-0"
  }
};

app.whenReady().then(async () => {
  const server = new OverlayServer({
    directory: path.join(__dirname, "..", "src", "overlay"),
    port: 0,
    getState: () => state
  });
  await server.start();
  const port = server.server.address().port;
  const window = new BrowserWindow({ show: false, width: 1920, height: 1080, backgroundColor: "#020407" });
  await window.loadURL(`http://127.0.0.1:${port}/overlay/?view=wheel`);
  await new Promise((resolve) => setTimeout(resolve, 700));
  await window.webContents.executeJavaScript(`
    document.querySelector('#wheel-scene').style.transition = 'none';
    document.querySelector('#wheel-scene').style.opacity = '1';
  `);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, (await window.webContents.capturePage()).toPNG());
  server.close();
  app.quit();
}).catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});
