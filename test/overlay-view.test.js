const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveOverlayView } = require("../src/overlay/view-mode");

test("기존 OBS 통합 주소는 모든 레이어와 알림음을 유지한다", () => {
  const result = resolveOverlayView("");
  assert.equal(result.view, "all");
  assert.equal(result.playsAudio, true);
  assert.deepEqual(result.layers, ["wheel", "hud", "roster", "donation", "sunrise", "end"]);
});

test("요소별 OBS 주소는 해당 레이어만 표시하고 알림음을 재생하지 않는다", () => {
  const result = resolveOverlayView("?view=donation");
  assert.equal(result.view, "donation");
  assert.equal(result.playsAudio, false);
  assert.deepEqual(result.layers, ["donation"]);
});

test("알림음 전용 OBS 주소는 화면 레이어 없이 소리만 담당한다", () => {
  const result = resolveOverlayView("?view=audio");
  assert.equal(result.view, "audio");
  assert.equal(result.playsAudio, true);
  assert.deepEqual(result.layers, []);
});

test("통합 OBS 주소도 명시적으로 무음 처리할 수 있다", () => {
  const result = resolveOverlayView("?view=all&audio=off");
  assert.equal(result.view, "all");
  assert.equal(result.playsAudio, false);
});

test("지원하지 않는 OBS 화면 이름은 기존 통합 화면으로 복구한다", () => {
  const result = resolveOverlayView("?view=unknown");
  assert.equal(result.view, "all");
  assert.equal(result.playsAudio, true);
});
