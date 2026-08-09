const test = require("node:test");
const assert = require("node:assert/strict");
const { createSpinAnimation, createWheelEntries } = require("../src/main/wheel-of-names-client");

const context = {
  round: 4,
  chanceUsed: 5,
  games: [
    { id: "game-a", name: "게임 A", slots: 1 },
    { id: "game-b", name: "게임 B", slots: 3 }
  ]
};

test("Wheel of Names 가중치에 방종과 게임 칸 확률을 반영한다", () => {
  const entries = createWheelEntries(context);
  assert.equal(entries.reduce((sum, entry) => sum + entry.weight, 0), 100);
  assert.deepEqual(entries.map(({ id, weight }) => ({ id, weight })), [
    { id: "end", weight: 5 },
    { id: "game-a", weight: 23.75 },
    { id: "game-b", weight: 71.25 }
  ]);
});

test("Wheel of Names 회전 영상과 당첨 ID를 읽는다", async () => {
  let request;
  const gif = Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.from([0, 1, 2, 3])]);
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({ winner: { id: "game-b", text: "게임 B" }, animation: gif.toString("base64") })
    };
  };
  const result = await createSpinAnimation({ apiKey: "test-key", context, fetchImpl });
  assert.equal(request.options.headers["x-api-key"], "test-key");
  const body = JSON.parse(request.options.body);
  assert.equal(body.wheelConfig.isAdvanced, true);
  assert.equal(body.imageFormat, "gif");
  assert.equal(body.webpQuality, undefined);
  assert.equal(result.winnerId, "game-b");
  assert.deepEqual(result.animation, gif);
  assert.equal(result.contentType, "image/gif");
  assert.equal(result.extension, "gif");
});

test("GIF가 아닌 Wheel of Names 회전 영상을 거부한다", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ winner: { id: "game-b" }, animation: Buffer.from("not-a-gif").toString("base64") })
  });
  await assert.rejects(
    createSpinAnimation({ apiKey: "test-key", context, fetchImpl }),
    /올바른 GIF 형식이 아닙니다/
  );
});

test("현재 목록에 없는 Wheel of Names 당첨 결과를 거부한다", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ winner: { id: "unknown" }, animation: Buffer.from("webp").toString("base64") })
  });
  await assert.rejects(
    createSpinAnimation({ apiKey: "test-key", context, fetchImpl }),
    /현재 목록과 일치하지 않습니다/
  );
});
