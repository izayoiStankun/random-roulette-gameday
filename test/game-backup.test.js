const test = require("node:test");
const assert = require("node:assert/strict");
const { createGameBackup, parseGameBackup } = require("../src/main/game-backup");

test("게임 목록만 JSON 백업으로 만들고 다시 불러온다", () => {
  const backup = createGameBackup([{
    id: "private-id",
    name: "  테스트   게임  ",
    slots: 4,
    enabled: true,
    installed: true,
    owned: true,
    source: "steam-local"
  }], new Date("2026-08-02T00:00:00Z"));
  assert.equal(backup.type, "random-roulette-gameday-games");
  assert.equal(backup.games[0].name, "테스트 게임");
  assert.equal(Object.hasOwn(backup.games[0], "id"), false);
  assert.deepEqual(parseGameBackup(JSON.stringify(backup)), backup.games);
});

test("중복 이름과 잘못된 항목을 제거하고 칸 수를 보정한다", () => {
  const games = parseGameBackup(JSON.stringify({
    type: "random-roulette-gameday-games",
    version: 1,
    games: [
      { name: "게임 A", slots: 0 },
      { name: "게임 A", slots: 20 },
      { name: "", slots: 2 },
      { name: "게임 B", slots: 99999 }
    ]
  }));
  assert.deepEqual(games.map(({ name, slots }) => ({ name, slots })), [
    { name: "게임 A", slots: 1 },
    { name: "게임 B", slots: 10000 }
  ]);
});

test("다른 형식의 JSON 파일은 거부한다", () => {
  assert.throws(() => parseGameBackup('{"games":[]}'), /백업 파일이 아닙니다/);
  assert.throws(() => parseGameBackup("not-json"), /올바른 JSON/);
});
