const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchOwnedGames, parseSteamProfile } = require("../src/main/steam-web-api");

test("SteamID64와 숫자형 프로필 주소를 해석한다", () => {
  assert.deepEqual(parseSteamProfile("76561198305422127"), {
    steamId: "76561198305422127",
    vanity: null
  });
  assert.deepEqual(parseSteamProfile("https://steamcommunity.com/profiles/76561198305422127/games/?tab=all"), {
    steamId: "76561198305422127",
    vanity: null
  });
});

test("사용자 지정 Steam 프로필 주소를 해석한다", () => {
  assert.deepEqual(parseSteamProfile("https://steamcommunity.com/id/example-user/"), {
    steamId: null,
    vanity: "example-user"
  });
});

test("Steam 웹 보유 목록을 룰렛 게임 형식으로 바꾼다", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({ response: { games: [
        { appid: 20, name: "게임 B" },
        { appid: 10, name: "게임 A" }
      ] } })
    };
  };
  const result = await fetchOwnedGames({
    apiKey: "secret-key",
    profile: "76561198305422127",
    fetchImpl
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /IPlayerService\/GetOwnedGames\/v1/);
  assert.equal(new URL(calls[0]).searchParams.get("include_appinfo"), "true");
  assert.deepEqual(result, {
    steamId: "76561198305422127",
    games: [
      { appId: "10", name: "게임 A", installed: false, owned: true },
      { appId: "20", name: "게임 B", installed: false, owned: true }
    ]
  });
});

test("게임 세부 정보가 비공개이면 안내한다", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ response: {} })
  });
  await assert.rejects(
    fetchOwnedGames({ apiKey: "secret-key", profile: "76561198305422127", fetchImpl }),
    /게임 세부 정보/
  );
});
