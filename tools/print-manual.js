const path = require("node:path");
const fs = require("node:fs/promises");
const { app, BrowserWindow } = require("electron");

const root = path.resolve(__dirname, "..");
const version = "0.2.0";
const input = path.join(root, "docs", "build", `랜덤룰렛게임데이-사용설명서-v${version}.html`);
const output = path.join(root, "docs", "build", `랜덤룰렛게임데이-사용설명서-v${version}.pdf`);
const preview = path.join(root, "docs", "build", `랜덤룰렛게임데이-사용설명서-v${version}-표지.png`);

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1200, height: 1600 });
  await window.loadFile(input);
  const pdf = await window.webContents.printToPDF({
    printBackground: true,
    pageSize: "A4",
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    preferCSSPageSize: true
  });
  await fs.writeFile(output, pdf);
  const cover = await window.webContents.capturePage({ x: 0, y: 0, width: 794, height: 1123 });
  await fs.writeFile(preview, cover.toPNG());
  console.log(output);
  console.log(preview);
  window.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
