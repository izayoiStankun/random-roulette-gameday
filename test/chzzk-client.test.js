const test = require("node:test");
const assert = require("node:assert/strict");
const { ChzzkClient } = require("../src/main/chzzk-client");

test("Socket.IO 2 호환 프레임에서 후원 이벤트를 추출한다", async () => {
  const client = new ChzzkClient({
    redirectUri: "http://127.0.0.1/callback",
    openExternal: () => {}
  });
  const donation = {
    donatorNickname: "테스트",
    payAmount: "1000",
    donationText: "Balatro 추가요"
  };
  const received = new Promise((resolve) => client.once("donation", resolve));
  client.handleSocketPacket(`42["DONATION",${JSON.stringify(donation)}]`);
  assert.deepEqual(await received, donation);
});

test("문자열 JSON으로 전달된 후원 페이로드도 처리한다", async () => {
  const client = new ChzzkClient({
    redirectUri: "http://127.0.0.1/callback",
    openExternal: () => {}
  });
  const donation = { donatorNickname: "문자열", payAmount: "2000", donationText: "!게임빼기 A" };
  const received = new Promise((resolve) => client.once("donation", resolve));
  client.handleSocketPacket(`42["DONATION",${JSON.stringify(JSON.stringify(donation))}]`);
  assert.deepEqual(await received, donation);
});
