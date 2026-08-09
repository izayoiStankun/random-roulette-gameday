const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { ChzzkClient, socketErrorMessage, validateSessionUrl } = require("../src/main/chzzk-client");

test("Socket.IO DONATION 이벤트를 후원 데이터로 전달한다", async () => {
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
  client.handleSocketEvent("DONATION", donation);
  assert.deepEqual(await received, donation);
});

test("문자열 JSON으로 전달된 후원 페이로드도 처리한다", async () => {
  const client = new ChzzkClient({
    redirectUri: "http://127.0.0.1/callback",
    openExternal: () => {}
  });
  const donation = { donatorNickname: "문자열", payAmount: "2000", donationText: "!게임빼기 A" };
  const received = new Promise((resolve) => client.once("donation", resolve));
  client.handleSocketEvent("DONATION", JSON.stringify(donation));
  assert.deepEqual(await received, donation);
});

test("치지직 세션 URL을 공식 Socket.IO 2 옵션으로 연결한다", () => {
  const socket = new EventEmitter();
  socket.close = () => { socket.closed = true; };
  let connection;
  const client = new ChzzkClient({
    redirectUri: "http://127.0.0.1/callback",
    openExternal: () => {},
    socketFactory: (url, options) => {
      connection = { url, options };
      return socket;
    }
  });
  client.shouldReconnect = true;
  client.openSocket("https://ssio.example.test:443?auth=token");
  assert.equal(connection.url, "https://ssio.example.test/?auth=token");
  assert.deepEqual(connection.options.transports, ["websocket"]);
  assert.equal(connection.options.reconnection, false);
  assert.equal(connection.options.forceNew, true);
  socket.emit("connect");
  assert.equal(client.status.phase, "socket-connected");
  client.disconnect();
  assert.equal(socket.closed, true);
});

test("연결 오류가 여러 번 발생해도 재연결 타이머는 하나만 예약한다", () => {
  const socket = new EventEmitter();
  socket.close = () => {};
  const client = new ChzzkClient({
    redirectUri: "http://127.0.0.1/callback",
    openExternal: () => {},
    socketFactory: () => socket
  });
  client.shouldReconnect = true;
  client.openSocket("https://ssio.example.test:443?auth=token");
  socket.emit("connect_error", new Error("handshake failed"));
  const timer = client.reconnectTimer;
  client.scheduleReconnect("duplicate");
  assert.equal(client.reconnectTimer, timer);
  assert.match(client.status.message, /handshake failed/);
  client.disconnect();
});

test("연결 오류 문구에 세션 토큰을 노출하지 않는다", () => {
  assert.equal(
    socketErrorMessage("wss://example.test/socket?auth=secret-token&transport=websocket"),
    "wss://example.test/socket?auth=[redacted]&transport=websocket"
  );
});

test("세션 URL은 길이를 제한하고 HTTPS만 허용한다", () => {
  assert.equal(
    validateSessionUrl("https://ssio.example.test:443?auth=token"),
    "https://ssio.example.test/?auth=token"
  );
  assert.throws(() => validateSessionUrl("http://ssio.example.test?auth=token"), /안전하지/);
  assert.throws(() => validateSessionUrl(`https://example.test/${"a".repeat(2100)}`), /올바르지/);
});
