const { EventEmitter } = require("node:events");
const { randomBytes, randomInt } = require("node:crypto");

const DEFAULT_SETTINGS = Object.freeze({
  mode: "manual",
  roundDurationSec: 30 * 60,
  endChanceStart: 5,
  endChanceMin: 3,
  endDeltaMin: -5,
  endDeltaMax: 10,
  overlayPort: 17554,
  updateChannel: "latest",
  addPrefix: "!게임추가",
  addSuffix: "추가요",
  removePrefix: "!게임빼기"
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

function defaultRandom() {
  return randomInt(0, 0x100000000) / 0x100000000;
}

class RouletteEngine extends EventEmitter {
  constructor(snapshot = {}, random = defaultRandom) {
    super();
    this.random = random;
    this.settings = { ...DEFAULT_SETTINGS, ...(snapshot.settings || {}) };
    this.games = Array.isArray(snapshot.games) ? snapshot.games : [];
    this.queue = Array.isArray(snapshot.queue) ? snapshot.queue : [];
    this.history = Array.isArray(snapshot.history) ? snapshot.history.slice(0, 100) : [];
    this.round = Number(snapshot.round) || 0;
    this.endChance = Number(snapshot.endChance) || 0;
    this.status = snapshot.status === "playing" ? "ready" : (snapshot.status || "idle");
    this.currentGame = snapshot.currentGame || null;
    this.timer = {
      running: false,
      remainingSec: Number(snapshot.timer?.remainingSec) || this.settings.roundDurationSec,
      endsAt: null
    };
    this.spin = null;
    this.lastDonation = null;
  }

  snapshot() {
    return {
      settings: this.settings,
      games: this.games,
      queue: this.queue,
      history: this.history,
      round: this.round,
      endChance: this.endChance,
      status: this.status,
      currentGame: this.currentGame,
      timer: this.timer,
      spin: this.spin,
      lastDonation: this.lastDonation
    };
  }

  persistentSnapshot() {
    const snapshot = this.snapshot();
    return { ...snapshot, spin: null, lastDonation: null };
  }

  notify() {
    this.emit("change", this.snapshot());
  }

  updateSettings(patch) {
    const next = { ...this.settings, ...patch };
    next.mode = next.mode === "auto" ? "auto" : "manual";
    next.updateChannel = next.updateChannel === "beta" ? "beta" : "latest";
    next.roundDurationSec = clamp(Number(next.roundDurationSec) || 1800, 10, 86400);
    next.endChanceStart = clamp(Number(next.endChanceStart) || 5, 0, 100);
    next.endChanceMin = clamp(Number(next.endChanceMin) || 3, 0, 100);
    next.endDeltaMin = clamp(Number(next.endDeltaMin), -100, 100);
    next.endDeltaMax = clamp(Number(next.endDeltaMax), -100, 100);
    if (next.endDeltaMin > next.endDeltaMax) {
      [next.endDeltaMin, next.endDeltaMax] = [next.endDeltaMax, next.endDeltaMin];
    }
    this.settings = next;
    if (!this.timer.running && this.status !== "playing") {
      this.timer.remainingSec = next.roundDurationSec;
    }
    this.notify();
  }

  addGame(name, options = {}) {
    const cleanName = normalizeName(name);
    if (!cleanName) throw new Error("게임 이름을 입력해 주세요.");
    const existing = this.findGame(cleanName);
    const slots = clamp(Number(options.slots) || 1, 1, 10000);
    if (existing) {
      existing.slots += slots;
      existing.enabled = true;
      existing.installed ||= Boolean(options.installed);
      existing.owned ||= Boolean(options.owned);
      this.notify();
      return existing;
    }
    const game = {
      id: createId("game"),
      name: cleanName,
      slots,
      enabled: options.enabled !== false,
      installed: Boolean(options.installed),
      owned: Boolean(options.owned || options.installed),
      source: options.source || "manual"
    };
    this.games.push(game);
    this.games.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    this.notify();
    return game;
  }

  mergeGames(items, source = "steam-local") {
    let added = 0;
    let updated = 0;
    for (const item of items) {
      const name = normalizeName(item.name);
      if (!name) continue;
      const existing = this.findGame(name);
      if (existing) {
        existing.installed ||= Boolean(item.installed);
        existing.owned ||= Boolean(item.owned || item.installed);
        existing.appId ||= item.appId;
        updated += 1;
      } else {
        this.games.push({
          id: createId("game"),
          name,
          slots: 1,
          enabled: true,
          installed: Boolean(item.installed),
          owned: Boolean(item.owned || item.installed),
          appId: item.appId || null,
          source
        });
        added += 1;
      }
    }
    this.games.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    this.notify();
    return { added, updated };
  }

  updateGame(id, patch) {
    const game = this.games.find((item) => item.id === id);
    if (!game) throw new Error("게임을 찾을 수 없습니다.");
    if (patch.name !== undefined) game.name = normalizeName(patch.name) || game.name;
    if (patch.slots !== undefined) game.slots = clamp(Number(patch.slots) || 1, 1, 10000);
    if (patch.enabled !== undefined) game.enabled = Boolean(patch.enabled);
    this.notify();
    return game;
  }

  removeGame(id) {
    const before = this.games.length;
    this.games = this.games.filter((item) => item.id !== id);
    if (this.games.length === before) throw new Error("게임을 찾을 수 없습니다.");
    this.notify();
  }

  findGame(name) {
    const needle = normalizeName(name).toLocaleLowerCase("ko");
    return this.games.find((game) => game.name.toLocaleLowerCase("ko") === needle);
  }

  parseDonation(donation) {
    const text = normalizeName(donation.donationText);
    const amount = Number(donation.payAmount) || 0;
    const addPrefix = normalizeName(this.settings.addPrefix);
    const addSuffix = normalizeName(this.settings.addSuffix);
    const removePrefix = normalizeName(this.settings.removePrefix);
    let kind = null;
    let gameName = "";

    if (addPrefix && text.startsWith(addPrefix)) {
      kind = "add";
      gameName = normalizeName(text.slice(addPrefix.length));
    } else if (removePrefix && text.startsWith(removePrefix)) {
      kind = "remove";
      gameName = normalizeName(text.slice(removePrefix.length));
    } else if (addSuffix && text.endsWith(addSuffix)) {
      kind = "add";
      gameName = normalizeName(text.slice(0, -addSuffix.length));
    }

    if (!kind || !gameName) return null;
    const unit = kind === "add" ? 1000 : 2000;
    const slots = Math.floor(amount / unit);
    if (slots < 1) return null;
    return {
      id: createId("request"),
      kind,
      gameName,
      slots,
      amount,
      donor: normalizeName(donation.donatorNickname) || "익명",
      donationType: donation.donationType || "CHAT",
      donationText: text,
      receivedAt: Date.now(),
      status: "pending"
    };
  }

  ingestDonation(donation) {
    this.lastDonation = {
      donor: normalizeName(donation.donatorNickname) || "익명",
      amount: Number(donation.payAmount) || 0,
      text: normalizeName(donation.donationText),
      receivedAt: Date.now()
    };
    const request = this.parseDonation(donation);
    if (!request) {
      this.notify();
      return { action: "ignored" };
    }

    const knownGame = this.findGame(request.gameName);
    const canAutoApply =
      this.settings.mode === "auto" &&
      knownGame &&
      (request.kind === "remove" || knownGame.owned || knownGame.installed);

    if (canAutoApply) {
      this.applyRequest(request, "auto");
      return { action: "applied", request };
    }
    this.queue.unshift(request);
    this.queue = this.queue.slice(0, 200);
    this.notify();
    return { action: "queued", request };
  }

  resolveRequest(id, decision, editedName) {
    const request = this.queue.find((item) => item.id === id);
    if (!request) throw new Error("대기 요청을 찾을 수 없습니다.");
    if (editedName) request.gameName = normalizeName(editedName);
    if (decision === "approve") {
      this.applyRequest(request, "manual");
    } else {
      request.status = "rejected";
      request.resolvedAt = Date.now();
      this.notify();
    }
    return request;
  }

  applyRequest(request, resolvedBy) {
    const game = this.findGame(request.gameName);
    if (request.kind === "add") {
      this.addGame(request.gameName, {
        slots: request.slots,
        owned: Boolean(game?.owned),
        installed: Boolean(game?.installed),
        source: game?.source || "donation"
      });
    } else {
      if (!game) throw new Error(`제거할 게임 "${request.gameName}"을 찾을 수 없습니다.`);
      game.slots = Math.max(0, game.slots - request.slots);
      if (game.slots === 0) game.enabled = false;
    }
    request.status = "applied";
    request.resolvedBy = resolvedBy;
    request.resolvedAt = Date.now();
    this.notify();
  }

  eligibleGames() {
    return this.games.filter((game) => game.enabled && game.slots > 0);
  }

  beginSpin() {
    if (this.status === "spinning" || this.status === "playing") {
      throw new Error("현재는 룰렛을 돌릴 수 없습니다.");
    }
    const games = this.eligibleGames();
    if (!games.length) throw new Error("활성화된 게임이 없습니다.");

    this.round += 1;
    if (this.round === 4 && this.endChance === 0) {
      this.endChance = this.settings.endChanceStart;
    }
    const chanceUsed = this.round >= 4 ? clamp(this.endChance, 0, 100) : 0;
    const roll = this.random() * 100;
    let resultType = "game";
    let resultName;
    let resultId;

    if (chanceUsed > 0 && roll < chanceUsed) {
      resultType = "end";
      resultName = "방종";
    } else {
      const totalSlots = games.reduce((sum, game) => sum + game.slots, 0);
      let cursor = this.random() * totalSlots;
      const selected = games.find((game) => {
        cursor -= game.slots;
        return cursor < 0;
      }) || games[games.length - 1];
      resultName = selected.name;
      resultId = selected.id;
    }

    this.spin = {
      id: createId("spin"),
      round: this.round,
      resultType,
      resultName,
      resultId,
      chanceUsed,
      games: games.map(({ id, name, slots }) => ({ id, name, slots })),
      startedAt: Date.now()
    };
    this.status = "spinning";
    this.timer.running = false;
    this.notify();
    return this.spin;
  }

  finalizeSpin(spinId) {
    if (!this.spin || this.spin.id !== spinId || this.status !== "spinning") return null;
    const spin = this.spin;
    let delta = 0;
    if (spin.resultType === "end") {
      this.status = "ended";
      this.currentGame = null;
    } else {
      this.status = "ready";
      this.currentGame = { id: spin.resultId, name: spin.resultName };
      this.timer = {
        running: false,
        remainingSec: this.settings.roundDurationSec,
        endsAt: null
      };
      if (this.round >= 4) {
        const range = this.settings.endDeltaMax - this.settings.endDeltaMin + 1;
        delta = this.settings.endDeltaMin + Math.floor(this.random() * range);
        this.endChance = clamp(
          spin.chanceUsed + delta,
          this.settings.endChanceMin,
          100
        );
      }
    }
    this.history.unshift({
      id: spin.id,
      round: spin.round,
      resultType: spin.resultType,
      resultName: spin.resultName,
      chanceUsed: spin.chanceUsed,
      endChanceDelta: delta,
      completedAt: Date.now()
    });
    this.history = this.history.slice(0, 100);
    this.notify();
    return spin;
  }

  startTimer() {
    if (!this.currentGame || !["ready", "paused"].includes(this.status)) {
      throw new Error("시작할 게임이 준비되어 있지 않습니다.");
    }
    const remaining = Math.max(1, Number(this.timer.remainingSec) || this.settings.roundDurationSec);
    this.timer = {
      running: true,
      remainingSec: remaining,
      endsAt: Date.now() + remaining * 1000
    };
    this.status = "playing";
    this.notify();
  }

  pauseTimer() {
    if (!this.timer.running) return;
    this.tick();
    this.timer.running = false;
    this.timer.endsAt = null;
    this.status = "paused";
    this.notify();
  }

  resetTimer() {
    this.timer = {
      running: false,
      remainingSec: this.settings.roundDurationSec,
      endsAt: null
    };
    if (this.currentGame) this.status = "ready";
    this.notify();
  }

  finishGameEarly() {
    if (!this.currentGame) return;
    this.timer = { running: false, remainingSec: 0, endsAt: null };
    this.status = "awaiting_spin";
    this.notify();
  }

  tick(now = Date.now()) {
    if (!this.timer.running || !this.timer.endsAt) return false;
    const remaining = Math.max(0, Math.ceil((this.timer.endsAt - now) / 1000));
    const changed = remaining !== this.timer.remainingSec;
    this.timer.remainingSec = remaining;
    if (remaining === 0) {
      this.timer.running = false;
      this.timer.endsAt = null;
      this.status = "awaiting_spin";
    }
    if (changed) this.notify();
    return remaining === 0;
  }

  resetEvent() {
    this.round = 0;
    this.endChance = 0;
    this.status = "idle";
    this.currentGame = null;
    this.spin = null;
    this.timer = {
      running: false,
      remainingSec: this.settings.roundDurationSec,
      endsAt: null
    };
    this.history = [];
    this.notify();
  }
}

module.exports = {
  DEFAULT_SETTINGS,
  RouletteEngine,
  normalizeName
};
