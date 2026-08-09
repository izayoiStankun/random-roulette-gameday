const BACKUP_VERSION = 1;

function normalizeBackupGame(item) {
  const name = String(item?.name || "").trim().replace(/\s+/g, " ");
  if (!name) return null;
  return {
    name,
    slots: Math.min(10000, Math.max(1, Number(item.slots) || 1)),
    enabled: item.enabled !== false,
    installed: Boolean(item.installed),
    owned: Boolean(item.owned || item.installed),
    appId: item.appId ? String(item.appId) : null,
    source: item.source ? String(item.source) : "backup"
  };
}

function sanitizeBackupGames(items) {
  if (!Array.isArray(items)) throw new Error("백업 파일에 게임 목록이 없습니다.");
  const seen = new Set();
  const games = [];
  for (const item of items) {
    const game = normalizeBackupGame(item);
    if (!game) continue;
    const key = game.name.toLocaleLowerCase("ko");
    if (seen.has(key)) continue;
    seen.add(key);
    games.push(game);
  }
  return games;
}

function createGameBackup(games, exportedAt = new Date()) {
  return {
    type: "random-roulette-gameday-games",
    version: BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    games: sanitizeBackupGames(games)
  };
}

function parseGameBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("올바른 JSON 백업 파일이 아닙니다.");
  }
  if (Array.isArray(parsed)) return sanitizeBackupGames(parsed);
  if (parsed?.type !== "random-roulette-gameday-games") {
    throw new Error("랜덤룰렛게임데이 목록 백업 파일이 아닙니다.");
  }
  if (Number(parsed.version) > BACKUP_VERSION) {
    throw new Error("더 최신 버전에서 만든 백업이라 불러올 수 없습니다.");
  }
  return sanitizeBackupGames(parsed.games);
}

module.exports = { BACKUP_VERSION, createGameBackup, parseGameBackup, sanitizeBackupGames };
