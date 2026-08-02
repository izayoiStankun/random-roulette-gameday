const { EventEmitter } = require("node:events");
const { randomBytes, randomInt } = require("node:crypto");
const { getSunriseStatus, isValidLocation } = require("./sunrise");

const DEFAULT_SETTINGS = Object.freeze({
  mode: "manual",
  roundDurationSec: 30 * 60,
  endChanceStart: 5,
  endChanceMin: 3,
  endDeltaMin: -5,
  endDeltaMax: 10,
  overlayPort: 17554,
  updateChannel: "latest",
  sunriseEnabled: false,
  sunriseLatitude: null,
  sunriseLongitude: null,
  nextRoundPreviewEnabled: true,
  soundOutput: "app",
  soundVolume: 70,
  wheelProvider: "local",
  removeWinnerAfterSpin: false,
  donationExcludeKeywords: "",
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
    this.cue = null;
    this.lastDonation = null;
  }

  snapshot() {
    const settings = { ...this.settings };
    delete settings.sunriseLatitude;
    delete settings.sunriseLongitude;
    return {
      settings,
      games: this.games,
      queue: this.queue,
      history: this.history,
      round: this.round,
      endChance: this.endChance,
      probability: this.probabilitySnapshot(),
      status: this.status,
      currentGame: this.currentGame,
      timer: this.timer,
      spin: this.spin,
      cue: this.cue,
      lastDonation: this.lastDonation,
      sunrise: getSunriseStatus(this.settings)
    };
  }

  probabilitySnapshot() {
    const round = this.status === "spinning" && this.spin ? this.round : this.round + 1;
    const endChance = this.status === "spinning" && this.spin
      ? this.spin.chanceUsed
      : round >= 4 ? clamp(this.endChance || this.settings.endChanceStart, 0, 100) : 0;
    return { round, endChance, gamesChance: 100 - endChance };
  }

  persistentSnapshot() {
    const snapshot = this.snapshot();
    return { ...snapshot, spin: null, cue: null, lastDonation: null };
  }

  notify() {
    this.emit("change", this.snapshot());
  }

  updateSettings(patch) {
    const next = { ...this.settings, ...patch };
    next.mode = next.mode === "auto" ? "auto" : "manual";
    next.updateChannel = next.updateChannel === "beta" ? "beta" : "latest";
    next.sunriseEnabled = Boolean(next.sunriseEnabled);
    next.nextRoundPreviewEnabled = next.nextRoundPreviewEnabled !== false;
    next.soundOutput = ["off", "app", "overlay", "both"].includes(next.soundOutput)
      ? next.soundOutput
      : "app";
    next.soundVolume = clamp(Number(next.soundVolume) || 0, 0, 100);
    next.wheelProvider = next.wheelProvider === "wheelofnames" ? "wheelofnames" : "local";
    next.removeWinnerAfterSpin = Boolean(next.removeWinnerAfterSpin);
    next.donationExcludeKeywords = String(next.donationExcludeKeywords || "").trim();
    const latitude = Number(next.sunriseLatitude);
    const longitude = Number(next.sunriseLongitude);
    const hasLocation = next.sunriseLatitude !== null && next.sunriseLatitude !== "" &&
      next.sunriseLongitude !== null && next.sunriseLongitude !== "";
    if (next.sunriseEnabled && hasLocation && isValidLocation(latitude, longitude)) {
      next.sunriseLatitude = latitude;
      next.sunriseLongitude = longitude;
    } else {
      next.sunriseEnabled = false;
      next.sunriseLatitude = null;
      next.sunriseLongitude = null;
    }
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

  removeGames(ids) {
    const targets = new Set(Array.isArray(ids) ? ids : []);
    const before = this.games.length;
    this.games = this.games.filter((item) => !targets.has(item.id));
    const removed = before - this.games.length;
    if (removed > 0) this.notify();
    return removed;
  }

  clearGames() {
    const removed = this.games.length;
    this.games = [];
    if (removed > 0) this.notify();
    return removed;
  }

  replaceGames(items) {
    this.games = items.map((item) => ({
      id: createId("game"),
      name: normalizeName(item.name),
      slots: clamp(Number(item.slots) || 1, 1, 10000),
      enabled: item.enabled !== false,
      installed: Boolean(item.installed),
      owned: Boolean(item.owned || item.installed),
      appId: item.appId || null,
      source: item.source || "backup"
    })).filter((item) => item.name);
    this.games.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    this.notify();
    return this.games.length;
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
    const donationText = normalizeName(donation.donationText).toLocaleLowerCase("ko");
    const excluded = this.settings.donationExcludeKeywords
      .split(/[,\n]/)
      .map((keyword) => normalizeName(keyword).toLocaleLowerCase("ko"))
      .filter(Boolean)
      .some((keyword) => donationText.includes(keyword));
    if (excluded) {
      this.notify();
      return { action: "ignored", reason: "excluded-message" };
    }
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

  prepareSpin() {
    if (this.status === "spinning" || this.status === "playing") {
      throw new Error("현재는 룰렛을 돌릴 수 없습니다.");
    }
    const games = this.eligibleGames();
    if (!games.length) throw new Error("활성화된 게임이 없습니다.");
    const round = this.round + 1;
    const currentEndChance = round === 4 && this.endChance === 0
      ? this.settings.endChanceStart
      : this.endChance;
    const chanceUsed = round >= 4 ? clamp(currentEndChance, 0, 100) : 0;
    return {
      round,
      chanceUsed,
      games: games.map(({ id, name, slots }) => ({ id, name, slots }))
    };
  }

  beginPreparedSpin(context, selectedId, metadata = {}) {
    if (!context || context.round !== this.round + 1) {
      throw new Error("룰렛 준비 정보가 만료되었습니다. 다시 돌려 주세요.");
    }
    if (this.status === "spinning" || this.status === "playing") {
      throw new Error("현재는 룰렛을 돌릴 수 없습니다.");
    }
    const selected = selectedId === "end"
      ? null
      : context.games.find((game) => game.id === selectedId);
    if (selectedId !== "end" && !selected) {
      throw new Error("룰렛 당첨 항목을 목록에서 찾지 못했습니다.");
    }
    if (selectedId === "end" && context.chanceUsed <= 0) {
      throw new Error("현재 회차에는 방종 항목이 없습니다.");
    }

    this.round = context.round;
    if (this.round === 4 && this.endChance === 0) {
      this.endChance = this.settings.endChanceStart;
    }
    const resultType = selectedId === "end" ? "end" : "game";
    this.spin = {
      id: createId("spin"),
      round: this.round,
      resultType,
      resultName: resultType === "end" ? "방종" : selected.name,
      resultId: selected?.id,
      chanceUsed: context.chanceUsed,
      games: context.games,
      startedAt: Date.now(),
      provider: metadata.provider || "local",
      animationVersion: metadata.animationVersion || null,
      fallbackReason: metadata.fallbackReason || null
    };
    this.status = "spinning";
    this.timer.running = false;
    this.notify();
    return this.spin;
  }

  beginSpin(metadata = {}) {
    const context = this.prepareSpin();
    const roll = this.random() * 100;
    let selectedId;
    if (context.chanceUsed > 0 && roll < context.chanceUsed) {
      selectedId = "end";
    } else {
      const totalSlots = context.games.reduce((sum, game) => sum + game.slots, 0);
      let cursor = this.random() * totalSlots;
      const selected = context.games.find((game) => {
        cursor -= game.slots;
        return cursor < 0;
      }) || context.games[context.games.length - 1];
      selectedId = selected.id;
    }
    return this.beginPreparedSpin(context, selectedId, metadata);
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
      if (this.settings.removeWinnerAfterSpin) {
        this.games = this.games.filter((game) => game.id !== spin.resultId);
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

  triggerCue(type) {
    if (!["countdown", "timer-ended"].includes(type)) {
      throw new Error("알 수 없는 알림음입니다.");
    }
    this.cue = { id: createId("cue"), type, createdAt: Date.now() };
    this.notify();
    return this.cue;
  }

  tick(now = Date.now()) {
    if (!this.timer.running || !this.timer.endsAt) return false;
    const previous = this.timer.remainingSec;
    const remaining = Math.max(0, Math.ceil((this.timer.endsAt - now) / 1000));
    const changed = remaining !== this.timer.remainingSec;
    this.timer.remainingSec = remaining;
    if (remaining === 0) {
      this.timer.running = false;
      this.timer.endsAt = null;
      this.status = "awaiting_spin";
      this.cue = { id: createId("cue"), type: "timer-ended", createdAt: now };
    } else if (previous > 4 && remaining <= 4) {
      this.cue = { id: createId("cue"), type: "countdown", createdAt: now };
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
    this.cue = null;
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
