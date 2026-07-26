const fs = require("node:fs");
const path = require("node:path");

function unescapeVdfPath(value) {
  return value.replace(/\\\\/g, "\\");
}

function candidateSteamRoots() {
  const roots = new Set();
  if (process.env["ProgramFiles(x86)"]) {
    roots.add(path.join(process.env["ProgramFiles(x86)"], "Steam"));
  }
  if (process.env.ProgramFiles) {
    roots.add(path.join(process.env.ProgramFiles, "Steam"));
  }
  return [...roots];
}

function parseManifest(content) {
  const appId = content.match(/"appid"\s+"([^"]+)"/i)?.[1];
  const name = content.match(/"name"\s+"([^"]+)"/i)?.[1];
  if (!appId || !name) return null;
  return { appId, name, installed: true, owned: true };
}

function scanSteamLibraries() {
  const steamRoots = candidateSteamRoots().filter((root) => fs.existsSync(root));
  if (!steamRoots.length) {
    throw new Error("기본 경로에서 Steam 설치를 찾지 못했습니다.");
  }
  const libraries = new Set(steamRoots);
  for (const root of steamRoots) {
    const libraryFile = path.join(root, "steamapps", "libraryfolders.vdf");
    if (!fs.existsSync(libraryFile)) continue;
    const content = fs.readFileSync(libraryFile, "utf8");
    for (const match of content.matchAll(/"path"\s+"([^"]+)"/gi)) {
      libraries.add(unescapeVdfPath(match[1]));
    }
  }

  const games = [];
  for (const library of libraries) {
    const steamApps = path.join(library, "steamapps");
    if (!fs.existsSync(steamApps)) continue;
    for (const filename of fs.readdirSync(steamApps)) {
      if (!/^appmanifest_\d+\.acf$/i.test(filename)) continue;
      try {
        const game = parseManifest(fs.readFileSync(path.join(steamApps, filename), "utf8"));
        if (game) games.push(game);
      } catch {
        // A manifest being updated by Steam should not abort the full import.
      }
    }
  }
  const unique = new Map(games.map((game) => [game.appId, game]));
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

module.exports = { parseManifest, scanSteamLibraries };
