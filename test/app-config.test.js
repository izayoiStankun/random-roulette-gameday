const test = require("node:test");
const assert = require("node:assert/strict");
const {
  HOSTED_CHZZK_CALLBACK_URI,
  LOCAL_CHZZK_CALLBACK_URI,
  resolveChzzkRedirectUri
} = require("../src/main/app-config");

test("기본 치지직 콜백은 기존 로컬 주소를 유지한다", () => {
  assert.equal(resolveChzzkRedirectUri(""), LOCAL_CHZZK_CALLBACK_URI);
});

test("준비된 HTTPS 호스팅 콜백을 선택할 수 있다", () => {
  assert.equal(resolveChzzkRedirectUri(HOSTED_CHZZK_CALLBACK_URI), HOSTED_CHZZK_CALLBACK_URI);
});

test("외부 HTTP 콜백은 거부한다", () => {
  assert.throws(() => resolveChzzkRedirectUri("http://example.com/callback"), /HTTPS/);
});
