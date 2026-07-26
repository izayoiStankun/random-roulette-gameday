const { EventEmitter } = require("node:events");
const { randomBytes } = require("node:crypto");
const WebSocket = require("ws");

const API_BASE = "https://openapi.chzzk.naver.com";
const AUTH_URL = "https://chzzk.naver.com/account-interlock";

class ChzzkClient extends EventEmitter {
  constructor({ redirectUri, openExternal }) {
    super();
    this.redirectUri = redirectUri;
    this.openExternal = openExternal;
    this.credentials = null;
    this.tokens = null;
    this.pendingState = null;
    this.socket = null;
    this.shouldReconnect = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.status = { phase: "disconnected", message: "연결 안 됨" };
  }

  setStatus(phase, message) {
    this.status = { phase, message };
    this.emit("status", this.status);
  }

  beginAuthorization(credentials) {
    if (!credentials.clientId || !credentials.clientSecret) {
      throw new Error("치지직 Client ID와 Client Secret을 입력해 주세요.");
    }
    this.credentials = credentials;
    this.pendingState = randomBytes(24).toString("hex");
    const url = new URL(AUTH_URL);
    url.searchParams.set("clientId", credentials.clientId);
    url.searchParams.set("redirectUri", this.redirectUri);
    url.searchParams.set("state", this.pendingState);
    this.setStatus("authorizing", "브라우저에서 권한을 승인해 주세요.");
    this.openExternal(url.toString());
  }

  async handleCallback({ code, state }) {
    if (!code || !state || state !== this.pendingState) {
      this.setStatus("error", "OAuth state 검증에 실패했습니다.");
      throw new Error("치지직 인증 응답을 검증하지 못했습니다.");
    }
    const content = await this.request("/auth/v1/token", {
      method: "POST",
      body: {
        grantType: "authorization_code",
        clientId: this.credentials.clientId,
        clientSecret: this.credentials.clientSecret,
        code,
        state
      },
      auth: "none"
    });
    this.tokens = {
      ...content,
      expiresAt: Date.now() + Number(content.expiresIn || 86400) * 1000
    };
    this.pendingState = null;
    this.emit("tokens", this.tokens);
    await this.connectSession();
  }

  restore(credentials, tokens) {
    this.credentials = credentials;
    this.tokens = tokens;
  }

  async refreshIfNeeded() {
    if (!this.tokens?.refreshToken) throw new Error("저장된 치지직 인증이 없습니다.");
    if (this.tokens.expiresAt && this.tokens.expiresAt > Date.now() + 60_000) return;
    const content = await this.request("/auth/v1/token", {
      method: "POST",
      body: {
        grantType: "refresh_token",
        refreshToken: this.tokens.refreshToken,
        clientId: this.credentials.clientId,
        clientSecret: this.credentials.clientSecret
      },
      auth: "none"
    });
    this.tokens = {
      ...content,
      expiresAt: Date.now() + Number(content.expiresIn || 86400) * 1000
    };
    this.emit("tokens", this.tokens);
  }

  async connectSession() {
    if (!this.credentials || !this.tokens) throw new Error("치지직 인증이 필요합니다.");
    this.setStatus("connecting", "후원 세션 연결 중…");
    await this.refreshIfNeeded();
    const content = await this.request("/open/v1/sessions/auth", {
      method: "GET",
      auth: "user"
    });
    const sessionUrl = content.url;
    if (!sessionUrl) throw new Error("치지직 세션 URL을 받지 못했습니다.");
    this.shouldReconnect = true;
    this.openSocket(sessionUrl);
  }

  openSocket(sessionUrl) {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.close();
    }
    const socketUrl = new URL(sessionUrl);
    socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
    socketUrl.searchParams.set("EIO", "3");
    socketUrl.searchParams.set("transport", "websocket");
    this.socket = new WebSocket(socketUrl.toString(), {
      handshakeTimeout: 5000,
      perMessageDeflate: false
    });
    this.socket.on("open", () => {
      this.reconnectAttempt = 0;
      this.setStatus("socket-connected", "세션 구독 준비 중…");
      this.socket.send("40");
    });
    this.socket.on("message", (data) => this.handleSocketPacket(data.toString()));
    this.socket.on("close", () => {
      if (this.shouldReconnect) this.scheduleReconnect();
    });
    this.socket.on("error", (error) => {
      this.setStatus("reconnecting", `세션 오류, 재연결 예정: ${error.message}`);
    });
  }

  handleSocketPacket(packet) {
    if (packet === "2") {
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send("3");
      return;
    }
    if (!packet.startsWith("42")) return;
    let event;
    try {
      event = JSON.parse(packet.slice(2));
    } catch {
      return;
    }
    if (!Array.isArray(event) || event.length < 2) return;
    const [eventType, rawPayload] = event;
    let payload = rawPayload;
    if (typeof rawPayload === "string") {
      try {
        payload = JSON.parse(rawPayload);
      } catch {
        payload = rawPayload;
      }
    }
    if (eventType === "SYSTEM") {
      this.handleSystemMessage(payload);
    } else if (eventType === "DONATION") {
      this.emit("donation", payload);
    }
  }

  async handleSystemMessage(payload) {
    if (payload?.type === "connected" && payload.data?.sessionKey) {
      try {
        await this.subscribeDonation(payload.data.sessionKey);
      } catch (error) {
        this.setStatus("error", error.message);
      }
    } else if (payload?.type === "subscribed" && payload.data?.eventType === "DONATION") {
      this.setStatus("connected", "후원 이벤트 수신 중");
    } else if (payload?.type === "revoked") {
      this.shouldReconnect = false;
      this.setStatus("error", "후원 조회 권한이 회수되었습니다.");
    }
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    const delay = Math.min(1000 * (2 ** this.reconnectAttempt), 15000);
    this.reconnectAttempt += 1;
    this.setStatus("reconnecting", `${Math.ceil(delay / 1000)}초 후 세션 재연결…`);
    this.reconnectTimer = setTimeout(() => {
      this.connectSession().catch((error) => {
        this.setStatus("reconnecting", `재연결 실패: ${error.message}`);
        this.scheduleReconnect();
      });
    }, delay);
  }

  async subscribeDonation(sessionKey) {
    const path = `/open/v1/sessions/events/subscribe/donation?sessionKey=${encodeURIComponent(sessionKey)}`;
    await this.request(path, { method: "POST", auth: "user" });
  }

  async request(path, options) {
    const headers = { "Content-Type": "application/json" };
    if (options.auth === "user") {
      headers.Authorization = `Bearer ${this.tokens.accessToken}`;
    }
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || (payload.code && Number(payload.code) >= 400)) {
      throw new Error(payload.message || `치지직 API 오류 (${response.status})`);
    }
    return payload.content || payload;
  }

  disconnect() {
    this.shouldReconnect = false;
    clearTimeout(this.reconnectTimer);
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.close();
    }
    this.socket = null;
    this.setStatus("disconnected", "연결 안 됨");
  }
}

module.exports = { ChzzkClient };
