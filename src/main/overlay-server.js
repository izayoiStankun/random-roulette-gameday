const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

class OverlayServer extends EventEmitter {
  constructor({ directory, port, getState }) {
    super();
    this.directory = directory;
    this.port = port;
    this.getState = getState;
    this.clients = new Set();
    this.server = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((request, response) => this.handle(request, response));
      this.server.once("error", reject);
      this.server.listen(this.port, "127.0.0.1", () => {
        this.server.off("error", reject);
        resolve();
      });
    });
  }

  handle(request, response) {
    const url = new URL(request.url, `http://127.0.0.1:${this.port}`);
    if (url.pathname === "/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*"
      });
      response.write(`event: state\ndata: ${JSON.stringify(this.getState())}\n\n`);
      this.clients.add(response);
      request.on("close", () => this.clients.delete(response));
      return;
    }

    if (url.pathname === "/api/state") {
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
      });
      response.end(JSON.stringify(this.getState()));
      return;
    }

    if (url.pathname === "/oauth/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      this.emit("oauth-callback", { code, state });
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        "<!doctype html><meta charset='utf-8'><title>연결 완료</title>" +
        "<style>body{font-family:sans-serif;background:#111;color:#fff;display:grid;place-items:center;height:100vh;margin:0}</style>" +
        "<h1>치지직 연결을 처리했습니다. 이 창을 닫아도 됩니다.</h1>"
      );
      return;
    }

    let relativePath = url.pathname === "/" || url.pathname === "/overlay/"
      ? "index.html"
      : url.pathname.replace(/^\/overlay\/?/, "");
    relativePath = decodeURIComponent(relativePath);
    const filePath = path.resolve(this.directory, relativePath);
    if (!filePath.startsWith(path.resolve(this.directory)) || !fs.existsSync(filePath)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES[extension] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    fs.createReadStream(filePath).pipe(response);
  }

  broadcast(state) {
    const payload = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
    for (const response of this.clients) {
      try {
        response.write(payload);
      } catch {
        this.clients.delete(response);
      }
    }
  }

  close() {
    for (const response of this.clients) response.end();
    this.clients.clear();
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(resolve);
    });
  }
}

module.exports = { OverlayServer };
