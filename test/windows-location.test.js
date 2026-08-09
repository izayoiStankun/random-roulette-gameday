const test = require("node:test");
const assert = require("node:assert/strict");
const { parseLocationOutput } = require("../src/main/windows-location");

test("Windows 위치 응답을 약 1km 단위로 반올림한다", () => {
  assert.deepEqual(parseLocationOutput('{"latitude":37.56651,"longitude":126.97804}'), {
    latitude: 37.57,
    longitude: 126.98
  });
});

test("PowerShell의 부가 출력이 있어도 마지막 JSON 응답을 읽는다", () => {
  assert.deepEqual(parseLocationOutput('notice\r\n{"latitude":35.18,"longitude":129.08}\r\n'), {
    latitude: 35.18,
    longitude: 129.08
  });
});

test("위치 JSON이 없으면 오류를 반환한다", () => {
  assert.throws(() => parseLocationOutput("no location"), /위치 응답/);
});
