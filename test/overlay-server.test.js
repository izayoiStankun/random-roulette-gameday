const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { OverlayServer } = require("../src/main/overlay-server");

test("요소별 OBS 쿼리 주소에서 오버레이와 화면 모듈을 제공한다", async (t) => {
  const server = new OverlayServer({
    directory: path.join(__dirname, "..", "src", "overlay"),
    port: 0,
    getState: () => ({ status: "idle" })
  });
  await server.start();
  t.after(() => server.close());
  const port = server.server.address().port;

  const overlayResponse = await fetch(`http://127.0.0.1:${port}/overlay/?view=wheel`);
  assert.equal(overlayResponse.status, 200);
  const overlayHtml = await overlayResponse.text();
  assert.match(overlayHtml, /view-mode\.js/);

  const moduleResponse = await fetch(`http://127.0.0.1:${port}/overlay/view-mode.js`);
  assert.equal(moduleResponse.status, 200);
  assert.match(moduleResponse.headers.get("content-type"), /text\/javascript/);
  assert.match(await moduleResponse.text(), /resolveOverlayView/);
});
