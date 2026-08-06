const { EventEmitter } = require("node:events");
const { randomBytes } = require("node:crypto");
const io = require("socket.io-client");

const API_BASE = "https://openapi.chzzk.naver.com";
const AUTH_URL = "https://chzzk.naver.com/account-interlock";

function normalizeSocketPayload(payload) {
  if (typeof payload !== "string") return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

function socketErrorMessage(error) {
  const message = typeof error === "string" ? error : error?.message || error?.type || "연결 종료";
  return String(message)
    .replace(/([?&]auth=)[^&\s]+/gi, "$1[redacted]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160) || "연결 종료";
}

function validateSessionUrl(value) {
  const raw = String(value || "");
  if (!raw || raw.length > 2048) throw new Error("치지직 세션 URL이 올바르지 않습니다.");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("치지직 세션 URL이 올바르지 않습니다.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("치지직 세션 URL이 안전하지 않습니다.");
  }
  return url.toString();
}

class ChzzkClient extends EventEmitter {
  constructor({ redirectUri, openExternal, socketFactory = io.connect }) {
    super();
    this.redirectUri = redirectUri;
    this.openExternal = openExternal;
    this.socketFactory = socketFactory;
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
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
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
    this.closeSocket();
    const safeSessionUrl = validateSessionUrl(sessionUrl);
    const socket = this.socketFactory(safeSessionUrl, {
      reconnection: false,
      forceNew: true,
      "force new connection": true,
      timeout: 5000,
      "connect timeout": 5000,
      transports: ["websocket"]
    });
    this.socket = socket;
    socket.on("connect", () => {
      if (this.socket !== socket) return;
      this.reconnectAttempt = 0;
      this.setStatus("socket-connected", "세션 구독 준비 중…");
    });
    socket.on("SYSTEM", (payload) => this.handleSocketEvent("SYSTEM", payload));
    socket.on("DONATION", (payload) => this.handleSocketEvent("DONATION", payload));
    socket.on("connect_error", (error) => this.handleSocketFailure(socket, error));
    socket.on("connect_timeout", () => this.handleSocketFailure(socket, "연결 시간 초과"));
    socket.on("error", (error) => this.handleSocketFailure(socket, error));
    socket.on("disconnect", (reason) => {
      if (this.socket !== socket || !this.shouldReconnect) return;
      this.closeSocket(socket);
      this.scheduleReconnect(reason);
    });
  }

  handleSocketEvent(eventType, rawPayload) {
    const payload = normalizeSocketPayload(rawPayload);
    if (eventType === "SYSTEM") {
      this.handleSystemMessage(payload);
    } else if (eventType === "DONATION") {
      this.emit("donation", payload);
    }
  }

  handleSocketFailure(socket, error) {
    if (this.socket !== socket || !this.shouldReconnect) return;
    this.closeSocket(socket);
    this.scheduleReconnect(error);
  }

  closeSocket(target = this.socket) {
    if (!target) return;
    if (this.socket === target) this.socket = null;
    target.removeAllListeners();
    try {
      target.close();
    } catch {
      // 이미 종료된 소켓은 정리만 마칩니다.
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

  scheduleReconnect(reason) {
    if (!this.shouldReconnect || this.reconnectTimer) return;
    const delay = Math.min(1000 * (2 ** this.reconnectAttempt), 15000);
    this.reconnectAttempt += 1;
    const detail = reason ? ` (${socketErrorMessage(reason)})` : "";
    this.setStatus("reconnecting", `세션 연결 끊김${detail} · ${Math.ceil(delay / 1000)}초 후 재연결…`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectSession().catch((error) => {
        this.scheduleReconnect(error);
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
    this.reconnectTimer = null;
    this.closeSocket();
    this.setStatus("disconnected", "연결 안 됨");
  }
}

module.exports = { ChzzkClient, normalizeSocketPayload, socketErrorMessage, validateSessionUrl };
