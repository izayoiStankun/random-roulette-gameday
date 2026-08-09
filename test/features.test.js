const test = require("node:test");
const assert = require("node:assert/strict");
const { RouletteEngine } = require("../src/main/engine");

test("정식판은 저장된 Wheel of Names 설정을 로컬 룰렛으로 이관한다", () => {
  const engine = new RouletteEngine({ settings: { wheelProvider: "wheelofnames" } });
  assert.equal(engine.settings.wheelProvider, "local");

  engine.updateSettings({ wheelProvider: "wheelofnames" });
  assert.equal(engine.settings.wheelProvider, "local");
});
