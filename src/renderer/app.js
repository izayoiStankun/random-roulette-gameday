let state;
let toastTimer;
let currentTab = "games";
let updateStatus;
let lastCueId;
const selectedGameIds = new Set();

const $ = (selector) => document.querySelector(selector);
const appSounds = {
  countdown: new Audio(new URL("../overlay/audio/countdown-4s.mp3", window.location.href)),
  "timer-ended": new Audio(new URL("../overlay/audio/timer-ended.mp3", window.location.href))
};
Object.values(appSounds).forEach((audio) => { audio.preload = "auto"; });
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function showToast(message, error = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast visible${error ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = "toast"; }, 3500);
}

async function command(name, payload) {
  try {
    return await window.roulette.command(name, payload);
  } catch (error) {
    showToast(error.message, true);
    throw error;
  }
}

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  return `${String(minutes).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function handleSoundCue(nextState) {
  const cue = nextState.cue;
  if (!cue || cue.id === lastCueId) return;
  lastCueId = cue.id;
  if (!["app", "both"].includes(nextState.settings.soundOutput)) return;
  const audio = appSounds[cue.type];
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
  audio.volume = Math.max(0, Math.min(1, Number(nextState.settings.soundVolume) / 100));
  audio.play().catch(() => showToast("알림음을 재생하지 못했습니다.", true));
}

const STATUS_LABELS = {
  idle: "대기 중",
  spinning: "룰렛 회전 중",
  ready: "게임 준비",
  playing: "플레이 중",
  paused: "일시 정지",
  awaiting_spin: "다음 룰렛 대기",
  ended: "방종 당첨"
};

function render(nextState) {
  state = nextState;
  handleSoundCue(state);
  $("#round").textContent = state.round;
  $("#timer").textContent = formatTime(state.timer.remainingSec);
  $("#status-label").textContent = STATUS_LABELS[state.status] || state.status;
  $("#current-game").textContent =
    state.status === "ended" ? "방종" :
    state.status === "spinning" ? "선택 중…" :
    state.currentGame?.name || "게임을 등록한 뒤 룰렛을 돌려주세요";
  const probability = state.probability || { round: state.round + 1, endChance: 0, gamesChance: 100 };
  $("#end-chance").textContent = probability.endChance > 0
    ? `${probability.round}회차 확률 · 방종 ${probability.endChance}% + 게임 전체 ${probability.gamesChance}%`
    : `1~3회차 게임 100% · 4회차부터 방종 ${state.settings.endChanceStart}% 반영`;

  $("#spin").disabled = ["spinning", "playing", "ended"].includes(state.status);
  $("#timer-toggle").disabled = !state.currentGame || ["spinning", "awaiting_spin", "ended"].includes(state.status);
  $("#timer-toggle").textContent = state.timer.running ? "일시 정지" :
    state.status === "paused" ? "계속하기" : "게임 시작";
  $("#finish-game").disabled = !state.currentGame || ["spinning", "awaiting_spin", "ended"].includes(state.status);

  document.querySelectorAll(".mode-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.settings.mode);
  });
  document.querySelectorAll(".update-channel-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.updateChannel === state.settings.updateChannel);
  });
  document.querySelectorAll(".sunrise-mode-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.sunriseMode === (state.settings.sunriseEnabled ? "on" : "off"));
  });
  document.querySelectorAll(".preview-mode-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.previewMode === (state.settings.nextRoundPreviewEnabled ? "on" : "off"));
  });
  document.querySelectorAll(".sound-output-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.soundOutput === state.settings.soundOutput);
  });
  document.querySelectorAll(".wheel-provider-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.wheelProvider === state.settings.wheelProvider);
  });
  document.querySelectorAll(".remove-winner-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.removeWinner === (state.settings.removeWinnerAfterSpin ? "on" : "off"));
  });
  $("#sound-volume").value = state.settings.soundVolume;
  $("#sound-volume-value").textContent = `${state.settings.soundVolume}%`;
  renderSunriseStatus();
  $("#queue-count").textContent = state.queue.filter((item) => item.status === "pending").length;
  renderGames();
  renderQueue();
  renderHistory();
  populateSettings();
}

function renderGames() {
  const currentIds = new Set(state.games.map((game) => game.id));
  for (const id of selectedGameIds) {
    if (!currentIds.has(id)) selectedGameIds.delete(id);
  }
  const filter = $("#game-filter").value.trim().toLocaleLowerCase("ko");
  const games = state.games.filter((game) => game.name.toLocaleLowerCase("ko").includes(filter));
  const totalSlots = state.games.filter((game) => game.enabled).reduce((sum, game) => sum + game.slots, 0);
  const endChance = totalSlots > 0 ? Number(state.probability?.endChance) || 0 : 0;
  const gamesChance = 100 - endChance;
  $("#game-summary").textContent = `${state.games.length}개 · 활성 ${totalSlots}칸 · 게임 ${gamesChance.toFixed(1)}% · 방종 ${endChance.toFixed(1)}%`;
  const endRow = endChance > 0 ? `
    <tr class="end-probability-row">
      <td></td><td>—</td>
      <td class="game-name">방종<small>${state.probability.round}회차 전체 확률에 반영</small></td>
      <td>—</td>
      <td><div class="probability-cell"><span>${endChance.toFixed(1)}%</span><i style="--probability:${endChance}%"></i></div></td>
      <td><span class="status-pill">특수 결과</span></td><td></td>
    </tr>` : "";
  const gameRows = games.map((game) => {
    const probability = game.enabled && totalSlots > 0 ? game.slots / totalSlots * gamesChance : 0;
    const probabilityLabel = `${probability < 1 && probability > 0 ? probability.toFixed(2) : probability.toFixed(1)}%`;
    return `
    <tr data-game-id="${escapeHtml(game.id)}">
      <td><input class="game-select" type="checkbox" ${selectedGameIds.has(game.id) ? "checked" : ""} aria-label="${escapeHtml(game.name)} 선택"></td>
      <td><input class="game-enabled" type="checkbox" ${game.enabled ? "checked" : ""}></td>
      <td class="game-name">${escapeHtml(game.name)}</td>
      <td><input class="slot-input" type="number" min="1" max="10000" value="${game.slots}"></td>
      <td><div class="probability-cell"><span>${probabilityLabel}</span><i style="--probability:${probability}%"></i></div></td>
      <td><span class="status-pill">${game.installed ? "설치됨" : game.owned ? "보유" : "미확인"}</span></td>
      <td><button class="icon-button game-delete" title="삭제">삭제</button></td>
    </tr>`;
  }).join("");
  $("#game-list").innerHTML = games.length || endRow
    ? `${endRow}${gameRows}`
    : `<tr><td colspan="7"><div class="empty">등록된 게임이 없습니다.</div></td></tr>`;
  updateBulkControls();
}

function updateBulkControls() {
  const allSelected = state.games.length > 0 && state.games.every((game) => selectedGameIds.has(game.id));
  $("#select-all-games").textContent = allSelected ? "전체 선택 해제" : "전체 선택";
  $("#select-all-games").disabled = state.games.length === 0;
  $("#delete-selected-games").disabled = selectedGameIds.size === 0;
  $("#clear-games").disabled = state.games.length === 0;
  $("#backup-games").disabled = state.games.length === 0;
  $("#selected-game-count").textContent = `${selectedGameIds.size}개 선택`;
}

function renderSunriseStatus() {
  if (!state.settings.sunriseEnabled) {
    $("#sunrise-status").textContent = "OFF · 위치를 사용하지 않습니다.";
    return;
  }
  if (!state.sunrise?.configured) {
    $("#sunrise-status").textContent = "위치 또는 일출 시각을 확인할 수 없습니다.";
    return;
  }
  if (!state.sunrise.sunriseAt) {
    $("#sunrise-status").textContent = "현재 위치에서 가까운 일출 시각을 계산할 수 없습니다.";
    return;
  }
  const sunrise = new Date(state.sunrise.sunriseAt);
  $("#sunrise-status").textContent = `다음 일출 ${sunrise.toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })} · 1시간 전부터 OBS 표시`;
}

function renderQueue() {
  const pendingItems = state.queue.filter((item) => item.status === "pending");
  const resolvedItems = state.queue.filter((item) => item.status !== "pending");
  const renderItem = (item, interactive) => `
    <div class="queue-item ${item.status !== "pending" ? "resolved" : ""}" data-request-id="${escapeHtml(item.id)}">
      <div>
        <strong>${item.kind === "add" ? "추가" : "제거"} ${item.slots}칸 · ${escapeHtml(item.donor)}</strong>
        <div class="queue-meta">${Number(item.amount).toLocaleString()}원 · “${escapeHtml(item.donationText)}” · ${item.status === "applied" ? "승인됨" : item.status === "rejected" ? "거절됨" : "대기 중"}</div>
      </div>
      ${interactive ? `<div class="queue-actions">
        <input class="request-game-name" value="${escapeHtml(item.gameName)}" aria-label="게임 이름">
        <button class="button request-approve">승인</button>
        <button class="button subtle request-reject">거절</button>
      </div>` : ""}
    </div>`;
  $("#pending-queue-summary").textContent = pendingItems.length
    ? `${pendingItems.length}개 요청을 확인해 주세요. 미등록·별칭 게임은 이름을 수정한 뒤 승인할 수 있습니다.`
    : "현재 확인할 요청이 없습니다.";
  $("#queue-list").innerHTML = pendingItems.length
    ? pendingItems.map((item) => renderItem(item, true)).join("")
    : `<div class="empty compact-empty">승인 대기 중인 후원 요청이 없습니다.</div>`;
  $("#resolved-queue-count").textContent = `${resolvedItems.length}개`;
  $("#queue-history").innerHTML = resolvedItems.length
    ? resolvedItems.slice(0, 50).map((item) => renderItem(item, false)).join("")
    : `<div class="empty compact-empty">아직 처리된 요청이 없습니다.</div>`;
}

function renderHistory() {
  $("#history-list").innerHTML = state.history.length ? state.history.map((item) => `
    <div class="history-item">
      <span>${item.round}회차</span>
      <strong class="${item.resultType === "end" ? "end" : ""}">${escapeHtml(item.resultName)}</strong>
      <span>방종 ${item.chanceUsed}% ${item.endChanceDelta ? `→ ${item.endChanceDelta > 0 ? "+" : ""}${item.endChanceDelta}%p` : ""}</span>
    </div>`).join("") : `<div class="empty">아직 룰렛 기록이 없습니다.</div>`;
}

function populateSettings() {
  const settings = state.settings;
  if (document.activeElement?.tagName === "INPUT") return;
  $("#round-minutes").value = settings.roundDurationSec / 60;
  $("#end-start").value = settings.endChanceStart;
  $("#end-min").value = settings.endChanceMin;
  $("#delta-min").value = settings.endDeltaMin;
  $("#delta-max").value = settings.endDeltaMax;
  $("#add-prefix").value = settings.addPrefix;
  $("#add-suffix").value = settings.addSuffix;
  $("#remove-prefix").value = settings.removePrefix;
  $("#donation-exclude").value = settings.donationExcludeKeywords;
  $("#redirect-uri").textContent = `http://127.0.0.1:${settings.overlayPort}/oauth/callback`;
  $("#overlay-uri").textContent = `http://127.0.0.1:${settings.overlayPort}/overlay/`;
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      currentTab = button.dataset.tab;
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab === button));
      document.querySelectorAll(".tab-page").forEach((page) => page.classList.toggle("active", page.id === `tab-${currentTab}`));
    });
  });

  $("#add-game-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await command("game:add", { name: $("#new-game").value, slots: Number($("#new-slots").value) });
    $("#new-game").value = "";
    $("#new-game").focus();
  });
  $("#game-filter").addEventListener("input", renderGames);
  $("#game-list").addEventListener("change", async (event) => {
    const row = event.target.closest("tr[data-game-id]");
    if (!row) return;
    if (event.target.classList.contains("game-select")) {
      if (event.target.checked) selectedGameIds.add(row.dataset.gameId);
      else selectedGameIds.delete(row.dataset.gameId);
      updateBulkControls();
      return;
    }
    if (event.target.classList.contains("game-enabled")) {
      await command("game:update", { id: row.dataset.gameId, patch: { enabled: event.target.checked } });
    }
    if (event.target.classList.contains("slot-input")) {
      await command("game:update", { id: row.dataset.gameId, patch: { slots: Number(event.target.value) } });
    }
  });
  $("#game-list").addEventListener("click", async (event) => {
    const row = event.target.closest("tr[data-game-id]");
    if (row && event.target.classList.contains("game-delete")) {
      selectedGameIds.delete(row.dataset.gameId);
      await command("game:remove", { id: row.dataset.gameId });
    }
  });
  $("#select-all-games").addEventListener("click", () => {
    const allSelected = state.games.length > 0 && state.games.every((game) => selectedGameIds.has(game.id));
    selectedGameIds.clear();
    if (!allSelected) state.games.forEach((game) => selectedGameIds.add(game.id));
    renderGames();
  });
  $("#delete-selected-games").addEventListener("click", async () => {
    const ids = [...selectedGameIds];
    if (!ids.length || !confirm(`선택한 게임 ${ids.length}개를 목록에서 삭제할까요?`)) return;
    const result = await command("game:remove-many", { ids });
    selectedGameIds.clear();
    showToast(`${result.removed}개 게임을 삭제했습니다.`);
  });
  $("#clear-games").addEventListener("click", async () => {
    if (!confirm(`게임 ${state.games.length}개를 전부 삭제할까요? 필요하면 먼저 리스트를 백업해 주세요.`)) return;
    const result = await command("game:clear");
    selectedGameIds.clear();
    showToast(`게임 목록 ${result.removed}개를 초기화했습니다.`);
  });
  $("#backup-games").addEventListener("click", async () => {
    const result = await command("game:backup");
    if (!result.canceled) showToast(`${result.count}개 게임 목록을 ${result.filePath.split(/[\\/]/).pop()}에 백업했습니다.`);
  });
  $("#restore-games").addEventListener("click", async () => {
    if (!confirm("백업을 불러오면 현재 게임 목록을 교체합니다. 계속할까요?")) return;
    const result = await command("game:restore");
    if (!result.canceled) {
      selectedGameIds.clear();
      showToast(`${result.imported}개 게임을 백업에서 불러왔습니다.`);
    }
  });
  $("#steam-scan").addEventListener("click", async () => {
    const result = await command("steam:scan");
    showToast(`Steam ${result.found}개 확인: ${result.added}개 추가, ${result.updated}개 갱신`);
  });
  $("#steam-web-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#steam-web-import");
    button.disabled = true;
    button.textContent = "Steam에서 불러오는 중…";
    try {
      const result = await command("steam:web-import", {
        profile: $("#steam-profile").value.trim(),
        apiKey: $("#steam-api-key").value.trim()
      });
      $("#steam-api-key").value = "";
      $("#steam-api-key").placeholder = "저장된 키 사용 (변경할 때만 입력)";
      $("#steam-web-status").textContent = `연결됨 · ${result.steamId}`;
      showToast(`Steam 보유 게임 ${result.found}개 확인: ${result.added}개 추가, ${result.updated}개 갱신`);
    } finally {
      button.disabled = false;
      button.textContent = "웹 보유 목록 불러오기";
    }
  });
  $("#steam-key-page").addEventListener("click", () => command("steam:key-page"));
  $("#steam-privacy-page").addEventListener("click", () => command("steam:privacy-page"));
  $("#overlay-open").addEventListener("click", () => command("overlay:open"));

  $("#spin").addEventListener("click", async () => {
    const button = $("#spin");
    button.disabled = true;
    button.textContent = state.settings.wheelProvider === "wheelofnames" ? "룰렛 영상 생성 중…" : "룰렛 회전 중…";
    try {
      await command("spin");
    } finally {
      button.textContent = "룰렛 돌리기";
    }
  });
  $("#timer-toggle").addEventListener("click", () => command(state.timer.running ? "timer:pause" : "timer:start"));
  $("#finish-game").addEventListener("click", () => command("game:finish"));

  $("#simulate-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await command("donation:simulate", {
      donatorNickname: $("#sim-donor").value,
      payAmount: String($("#sim-amount").value),
      donationText: $("#sim-text").value,
      donationType: "CHAT"
    });
    showToast(result.action === "ignored"
      ? result.reason === "excluded-message"
        ? "제외 문구를 감지해 룰렛 요청에 반영하지 않았습니다."
        : "명령 또는 금액 조건에 맞지 않아 반영하지 않았습니다."
      : `후원 요청: ${result.action}`);
  });
  document.querySelectorAll(".example-chip").forEach((button) => {
    button.addEventListener("click", () => {
      $("#sim-text").value = button.dataset.donationExample;
      $("#sim-text").focus();
      $("#sim-text").select();
    });
  });
  $("#queue-list").addEventListener("click", async (event) => {
    const item = event.target.closest("[data-request-id]");
    if (!item) return;
    if (event.target.classList.contains("request-approve")) {
      await command("request:resolve", {
        id: item.dataset.requestId,
        decision: "approve",
        gameName: item.querySelector(".request-game-name").value
      });
    } else if (event.target.classList.contains("request-reject")) {
      await command("request:resolve", { id: item.dataset.requestId, decision: "reject" });
    }
  });

  document.querySelectorAll(".mode-button").forEach((button) => {
    button.addEventListener("click", () => command("settings:update", { mode: button.dataset.mode }));
  });
  document.querySelectorAll(".update-channel-button").forEach((button) => {
    button.addEventListener("click", async () => {
      await command("settings:update", { updateChannel: button.dataset.updateChannel });
      showToast(button.dataset.updateChannel === "beta" ? "테스트판 업데이트도 확인합니다." : "정식판 업데이트만 확인합니다.");
    });
  });
  document.querySelector('[data-sunrise-mode="off"]').addEventListener("click", async () => {
    await command("settings:update", { sunriseEnabled: false });
    showToast("썬라이즈 카운트다운을 끄고 저장된 위치를 삭제했습니다.");
  });
  document.querySelector('[data-sunrise-mode="on"]').addEventListener("click", enableSunriseCountdown);
  document.querySelectorAll(".preview-mode-button").forEach((button) => {
    button.addEventListener("click", () => command("settings:update", {
      nextRoundPreviewEnabled: button.dataset.previewMode === "on"
    }));
  });
  document.querySelectorAll(".sound-output-button").forEach((button) => {
    button.addEventListener("click", () => command("settings:update", {
      soundOutput: button.dataset.soundOutput
    }));
  });
  document.querySelectorAll(".wheel-provider-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const provider = button.dataset.wheelProvider;
      await command("wheel:settings", { provider });
      showToast(provider === "wheelofnames" ? "Wheel of Names 룰렛을 사용합니다." : "기존 로컬 룰렛을 사용합니다.");
    });
  });
  $("#wheel-api-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await command("wheel:settings", {
      provider: "wheelofnames",
      apiKey: $("#wheel-api-key").value.trim()
    });
    $("#wheel-api-key").value = "";
    $("#wheel-api-key").placeholder = "저장된 키 사용 (변경할 때만 입력)";
    showToast("Wheel of Names API 키를 안전하게 저장했습니다.");
  });
  document.querySelectorAll(".remove-winner-button").forEach((button) => {
    button.addEventListener("click", () => command("settings:update", {
      removeWinnerAfterSpin: button.dataset.removeWinner === "on"
    }));
  });
  $("#sound-volume").addEventListener("input", (event) => {
    $("#sound-volume-value").textContent = `${event.target.value}%`;
  });
  $("#sound-volume").addEventListener("change", (event) => command("settings:update", {
    soundVolume: Number(event.target.value)
  }));
  $("#test-countdown-sound").addEventListener("click", () => command("sound:test", { type: "countdown" }));
  $("#test-ended-sound").addEventListener("click", () => command("sound:test", { type: "timer-ended" }));
  $("#rules-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await command("settings:update", {
      roundDurationSec: Number($("#round-minutes").value) * 60,
      endChanceStart: Number($("#end-start").value),
      endChanceMin: Number($("#end-min").value),
      endDeltaMin: Number($("#delta-min").value),
      endDeltaMax: Number($("#delta-max").value),
      addPrefix: $("#add-prefix").value,
      addSuffix: $("#add-suffix").value,
      removePrefix: $("#remove-prefix").value,
      donationExcludeKeywords: $("#donation-exclude").value
    });
    showToast("규칙을 저장했습니다.");
  });
  $("#chzzk-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await window.roulette.saveAndConnectChzzk({
      clientId: $("#client-id").value.trim(),
      clientSecret: $("#client-secret").value.trim()
    }).catch((error) => showToast(error.message, true));
  });
  $("#chzzk-reconnect").addEventListener("click", () => {
    window.roulette.reconnectChzzk().catch((error) => showToast(error.message, true));
  });
  $("#reset-event").addEventListener("click", async () => {
    if (confirm("게임 목록은 유지하고 회차·타이머·룰렛 기록을 초기화할까요?")) {
      await command("event:reset");
    }
  });
  $("#update-check").addEventListener("click", () => runUpdateAction(() => window.roulette.checkForUpdates()));
  $("#update-download").addEventListener("click", () => runUpdateAction(() => window.roulette.downloadUpdate()));
  $("#update-install").addEventListener("click", () => runUpdateAction(() => window.roulette.installUpdate()));
  $("#update-open").addEventListener("click", () => runUpdateAction(() => window.roulette.openUpdatePage()));
}

async function enableSunriseCountdown() {
  if (state.settings.sunriseEnabled) return;
  const approved = confirm("현재 지역을 기준으로 일출 시간을 설정합니다. 위치는 약 1km 단위로 반올림되어 이 PC의 Windows 보안 저장소에만 보관됩니다. 그래도 적용하시겠어요?");
  if (!approved) return;
  showToast("Windows에서 현재 위치를 확인하고 있습니다…");
  try {
    const { latitude, longitude } = await window.roulette.getCurrentLocation();
    await command("settings:update", { sunriseEnabled: true, sunriseLatitude: latitude, sunriseLongitude: longitude });
    showToast("현재 지역 기준의 일출 카운트다운을 켰습니다.");
  } catch (error) {
    showToast(error.message || "위치 확인에 실패했습니다.", true);
  }
}

async function runUpdateAction(action) {
  try {
    const result = await action();
    if (result?.phase) renderUpdateStatus(result);
  } catch (error) {
    showToast(error.message, true);
  }
}

function renderUpdateStatus(status) {
  updateStatus = status;
  $("#update-version").textContent = `현재 ${status.currentVersion}${status.availableVersion ? ` · 새 버전 ${status.availableVersion}` : ""}`;
  $("#update-kind").textContent = status.isPortable ? "포터블" : "설치형";
  $("#update-status").textContent = status.message;
  const downloading = status.phase === "downloading";
  $("#update-progress").hidden = !downloading;
  $("#update-progress").value = status.progress || 0;
  $("#update-check").disabled = ["checking", "downloading"].includes(status.phase);
  $("#update-download").disabled = status.phase !== "available";
  $("#update-download").textContent = status.isPortable ? "다운로드 페이지 열기" : "다운로드";
  $("#update-install").disabled = status.isPortable || status.phase !== "downloaded";
}

function updateChzzkStatus(status) {
  $("#chzzk-status").textContent = status.message;
  $("#chzzk-dot").className = `dot ${status.phase === "connected" ? "connected" : status.phase === "error" ? "error" : ""}`;
}

function updateWheelStatus(status) {
  $("#wheel-provider-status").textContent = status.message;
  if (status.phase === "fallback") showToast(status.message, true);
}

async function initialize() {
  bindEvents();
  render(await window.roulette.getState());
  const summary = await window.roulette.getSecretsSummary();
  $("#client-id").value = summary.clientId;
  $("#chzzk-reconnect").disabled = !summary.hasCredentials;
  if (summary.steamProfile) $("#steam-profile").value = summary.steamProfile;
  if (summary.hasSteamApiKey) {
    $("#steam-api-key").placeholder = "저장된 키 사용 (변경할 때만 입력)";
    $("#steam-web-status").textContent = "API 키 저장됨";
  }
  if (summary.hasWheelOfNamesApiKey) {
    $("#wheel-api-key").placeholder = "저장된 키 사용 (변경할 때만 입력)";
    $("#wheel-provider-status").textContent = state.settings.wheelProvider === "wheelofnames"
      ? "Wheel of Names 사용 준비됨"
      : "API 키 저장됨 · 현재 로컬 룰렛";
  }
  window.roulette.onState(render);
  window.roulette.onChzzkStatus(updateChzzkStatus);
  renderUpdateStatus(await window.roulette.getUpdateStatus());
  window.roulette.onUpdateStatus(renderUpdateStatus);
  window.roulette.onWheelStatus(updateWheelStatus);
}

initialize().catch((error) => showToast(error.message, true));
