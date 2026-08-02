const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..", "src", "overlay", "audio");
const EXPECTED = {
  "timer-ended.mp3": "1431ec6e48e69d0be46b272cb32b81be59b831bfff9b5cd8af342a94089ff1ee",
  "countdown-4s.mp3": "d8a04c85add15fb8eef38e4ebe15aca305c62378da81a622f207b704528f06ce"
};

test("배포용 타이머 음원 파일이 원본과 일치한다", () => {
  for (const [name, expectedHash] of Object.entries(EXPECTED)) {
    const data = fs.readFileSync(path.join(ROOT, name));
    assert.ok(data.length > 10_000, `${name} 파일이 너무 작습니다.`);
    assert.equal(crypto.createHash("sha256").update(data).digest("hex"), expectedHash);
  }
});
