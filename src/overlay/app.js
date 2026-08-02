const canvas = document.querySelector("#wheel");
const context = canvas.getContext("2d");
const wheelScene = document.querySelector("#wheel-scene");
const gameHud = document.querySelector("#game-hud");
const endScene = document.querySelector("#end-scene");
const donationPop = document.querySelector("#donation-pop");
const gameRoster = document.querySelector("#game-roster");
const sunriseCountdown = document.querySelector("#sunrise-countdown");
const overlaySounds = {
  countdown: document.querySelector("#sound-countdown"),
  "timer-ended": document.querySelector("#sound-timer-ended")
};
const palette = ["#0ea5a8", "#1686b9", "#485bb5", "#8b4eb6", "#ca4b87", "#e05c5c", "#d98434", "#a4a83c"];
let lastSpinId = null;
let lastDonationAt = null;
let donationTimer;
let lastCueId;
let state;

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function formatClock(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value % 3600 / 60);
  const remainingSeconds = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function handleSoundCue(nextState) {
  const cue = nextState.cue;
  if (!cue || cue.id === lastCueId) return;
  lastCueId = cue.id;
  if (!["overlay", "both"].includes(nextState.settings.soundOutput)) return;
  const audio = overlaySounds[cue.type];
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
  audio.volume = Math.max(0, Math.min(1, Number(nextState.settings.soundVolume) / 100));
  audio.play().catch(() => {});
}

function buildSlices(spin) {
  const chance = spin.chanceUsed || 0;
  const gameTotal = spin.games.reduce((sum, game) => sum + game.slots, 0);
  const slices = [];
  if (chance > 0) {
    slices.push({ type: "end", name: "방종", weight: chance / 100, color: "#ef334f" });
  }
  const remaining = (100 - chance) / 100;
  spin.games.forEach((game, index) => {
    slices.push({
      type: "game",
      id: game.id,
      name: game.name,
      weight: remaining * (game.slots / gameTotal),
      color: palette[index % palette.length]
    });
  });
  return slices;
}

function drawWheel(slices) {
  const center = canvas.width / 2;
  const radius = center - 12;
  context.clearRect(0, 0, canvas.width, canvas.height);
  let cursor = -Math.PI / 2;
  slices.forEach((slice) => {
    const angle = slice.weight * Math.PI * 2;
    context.beginPath();
    context.moveTo(center, center);
    context.arc(center, center, radius, cursor, cursor + angle);
    context.closePath();
    context.fillStyle = slice.color;
    context.fill();
    context.strokeStyle = "#f5fbfc";
    context.lineWidth = 2;
    context.stroke();

    if (angle > 0.06) {
      context.save();
      context.translate(center, center);
      context.rotate(cursor + angle / 2);
      context.textAlign = "right";
      context.fillStyle = "white";
      context.font = `800 ${angle > .2 ? 21 : 15}px Pretendard, sans-serif`;
      context.shadowColor = "#000b";
      context.shadowBlur = 5;
      const maxChars = angle > .2 ? 22 : 12;
      const label = slice.name.length > maxChars ? `${slice.name.slice(0, maxChars - 1)}…` : slice.name;
      context.fillText(label, radius - 28, 7);
      context.restore();
    }
    cursor += angle;
  });
}

function spinWheel(spin) {
  const slices = buildSlices(spin);
  drawWheel(slices);
  let cursor = 0;
  let targetCenter = 0;
  for (const slice of slices) {
    const center = cursor + slice.weight * 180;
    const selected = spin.resultType === "end"
      ? slice.type === "end"
      : slice.id === spin.resultId;
    if (selected) targetCenter = center;
    cursor += slice.weight * 360;
  }
  canvas.style.transition = "none";
  canvas.style.transform = "rotate(0deg)";
  void canvas.offsetWidth;
  canvas.style.transition = "transform 6s cubic-bezier(.12,.72,.08,1)";
  canvas.style.transform = `rotate(${360 * 8 - targetCenter}deg)`;
}

function showDonation(donation) {
  if (!donation || donation.receivedAt === lastDonationAt) return;
  lastDonationAt = donation.receivedAt;
  document.querySelector("#donation-donor").textContent = donation.donor;
  document.querySelector("#donation-amount").textContent = `${Number(donation.amount).toLocaleString()}원`;
  document.querySelector("#donation-text").textContent = donation.text || "후원 감사합니다!";
  donationPop.classList.remove("hidden");
  clearTimeout(donationTimer);
  donationTimer = setTimeout(() => donationPop.classList.add("hidden"), 5500);
}

function renderRoster(games, preview, probabilityState) {
  const totalSlots = games.reduce((sum, game) => sum + game.slots, 0);
  const endChance = Number(probabilityState?.endChance) || 0;
  const gamesChance = 100 - endChance;
  document.querySelector("#roster-kicker").textContent = preview ? "NEXT ROUND PREVIEW" : "ROULETTE POOL";
  document.querySelector("#roster-title").textContent = preview ? "다음 라운드 미리보기" : "룰렛 목록";
  document.querySelector("#roster-summary").textContent = endChance > 0
    ? `게임 ${gamesChance}% · 방종 ${endChance}%`
    : `${games.length}개 · 총 ${totalSlots}칸 · 게임 100%`;
  const list = document.querySelector("#roster-list");
  list.replaceChildren();
  if (endChance > 0) {
    const endRow = document.createElement("div");
    endRow.className = "roster-item roster-end";
    const rank = document.createElement("span");
    rank.textContent = "END";
    const name = document.createElement("strong");
    name.textContent = "방종";
    const slots = document.createElement("small");
    slots.textContent = `${probabilityState.round}회차`;
    const chance = document.createElement("em");
    chance.textContent = `${endChance.toFixed(1)}%`;
    endRow.append(rank, name, slots, chance);
    list.append(endRow);
  }
  games.slice(0, 12).forEach((game, index) => {
    const probability = totalSlots > 0 ? game.slots / totalSlots * gamesChance : 0;
    const row = document.createElement("div");
    row.className = "roster-item";
    const rank = document.createElement("span");
    rank.textContent = String(index + 1).padStart(2, "0");
    const name = document.createElement("strong");
    name.textContent = game.name;
    const slots = document.createElement("small");
    slots.textContent = `${game.slots}칸`;
    const chance = document.createElement("em");
    chance.textContent = `${probability < 1 && probability > 0 ? probability.toFixed(2) : probability.toFixed(1)}%`;
    row.append(rank, name, slots, chance);
    list.append(row);
  });
  if (games.length > 12) {
    const more = document.createElement("div");
    more.className = "roster-more";
    more.textContent = `외 ${games.length - 12}개 게임`;
    list.append(more);
  }
}

function renderSunrise(sunrise) {
  const visible = Boolean(sunrise?.enabled && sunrise.configured && sunrise.visible && sunrise.sunriseAt);
  sunriseCountdown.classList.toggle("hidden", !visible);
  if (!visible) return;
  document.querySelector("#sunrise-timer").textContent = formatClock(sunrise.remainingSec);
  const sunriseTime = new Date(sunrise.sunriseAt);
  document.querySelector("#sunrise-time").textContent = `일출 ${sunriseTime.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
}

function render(nextState) {
  state = nextState;
  handleSoundCue(state);
  const isSpinning = state.status === "spinning" && state.spin;
  wheelScene.classList.toggle("hidden", !isSpinning);
  endScene.classList.toggle("hidden", state.status !== "ended");
  const showHud = Boolean(state.currentGame) && !isSpinning && ["ready", "playing", "paused"].includes(state.status);
  gameHud.classList.toggle("hidden", !showHud);
  const games = state.games.filter((game) => game.enabled && game.slots > 0);
  const isWaiting = ["idle", "awaiting_spin"].includes(state.status);
  const isPreview = state.settings.nextRoundPreviewEnabled && (
    state.status === "ready" ||
    (state.status === "playing" && state.timer.running && state.timer.remainingSec > 0 && state.timer.remainingSec <= 120)
  );
  const showRoster = games.length > 0 && !isSpinning && state.status !== "ended" && (isWaiting || isPreview);
  gameRoster.classList.toggle("hidden", !showRoster);
  gameRoster.classList.toggle("preview", isPreview);
  if (showRoster) renderRoster(games, isPreview, state.probability);
  renderSunrise(state.sunrise);

  if (isSpinning) {
    document.querySelector("#wheel-round").textContent = state.spin.round;
    document.querySelector("#chance-callout").textContent = state.spin.chanceUsed
      ? `방종 확률 ${state.spin.chanceUsed}%`
      : "게임 룰렛";
    if (state.spin.id !== lastSpinId) {
      lastSpinId = state.spin.id;
      spinWheel(state.spin);
    }
  }
  if (showHud) {
    document.querySelector("#hud-status").textContent = `${state.status.toUpperCase()} · ROUND ${state.round}`;
    document.querySelector("#hud-game").textContent = state.currentGame.name;
    document.querySelector("#hud-chance").textContent = state.round < 4
      ? `END OPENS AT ROUND 4 · ${state.settings.endChanceStart}%`
      : `NEXT END ${state.endChance}%`;
    document.querySelector("#hud-timer").textContent = formatTime(state.timer.remainingSec);
    const ratio = Math.max(0, Math.min(1, state.timer.remainingSec / state.settings.roundDurationSec));
    document.querySelector("#timer-progress").style.width = `${ratio * 100}%`;
  }
  showDonation(state.lastDonation);
}

fetch("/api/state").then((response) => response.json()).then(render);
const events = new EventSource("/events");
events.addEventListener("state", (event) => render(JSON.parse(event.data)));
