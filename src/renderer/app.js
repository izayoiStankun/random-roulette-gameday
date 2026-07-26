let state;
let toastTimer;
let currentTab = "games";

const $ = (selector) => document.querySelector(selector);
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
  $("#round").textContent = state.round;
  $("#timer").textContent = formatTime(state.timer.remainingSec);
  $("#status-label").textContent = STATUS_LABELS[state.status] || state.status;
  $("#current-game").textContent =
    state.status === "ended" ? "방종" :
    state.status === "spinning" ? "선택 중…" :
    state.currentGame?.name || "게임을 등록한 뒤 룰렛을 돌려주세요";
  $("#end-chance").textContent = state.round < 4
    ? `4회차부터 방종 ${state.settings.endChanceStart}%`
    : `다음 방종 확률 ${state.endChance}%`;

  $("#spin").disabled = ["spinning", "playing", "ended"].includes(state.status);
  $("#timer-toggle").disabled = !state.currentGame || ["spinning", "awaiting_spin", "ended"].includes(state.status);
  $("#timer-toggle").textContent = state.timer.running ? "일시 정지" :
    state.status === "paused" ? "계속하기" : "게임 시작";
  $("#finish-game").disabled = !state.currentGame || ["spinning", "awaiting_spin", "ended"].includes(state.status);

  document.querySelectorAll(".mode-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.settings.mode);
  });
  $("#queue-count").textContent = state.queue.filter((item) => item.status === "pending").length;
  renderGames();
  renderQueue();
  renderHistory();
  populateSettings();
}

function renderGames() {
  const filter = $("#game-filter").value.trim().toLocaleLowerCase("ko");
  const games = state.games.filter((game) => game.name.toLocaleLowerCase("ko").includes(filter));
  const totalSlots = state.games.filter((game) => game.enabled).reduce((sum, game) => sum + game.slots, 0);
  $("#game-summary").textContent = `${state.games.length}개 · 활성 ${totalSlots}칸`;
  $("#game-list").innerHTML = games.length ? games.map((game) => `
    <tr data-game-id="${escapeHtml(game.id)}">
      <td><input class="game-enabled" type="checkbox" ${game.enabled ? "checked" : ""}></td>
      <td class="game-name">${escapeHtml(game.name)}</td>
      <td><input class="slot-input" type="number" min="1" max="10000" value="${game.slots}"></td>
      <td><span class="status-pill">${game.installed ? "설치됨" : game.owned ? "보유" : "미확인"}</span></td>
      <td><button class="icon-button game-delete" title="삭제">삭제</button></td>
    </tr>`).join("") : `<tr><td colspan="5"><div class="empty">등록된 게임이 없습니다.</div></td></tr>`;
}

function renderQueue() {
  const items = state.queue;
  $("#queue-list").innerHTML = items.length ? items.map((item) => `
    <div class="queue-item ${item.status !== "pending" ? "resolved" : ""}" data-request-id="${escapeHtml(item.id)}">
      <div>
        <strong>${item.kind === "add" ? "추가" : "제거"} ${item.slots}칸 · ${escapeHtml(item.donor)}</strong>
        <div class="queue-meta">${Number(item.amount).toLocaleString()}원 · “${escapeHtml(item.donationText)}” · ${item.status}</div>
      </div>
      ${item.status === "pending" ? `<div class="queue-actions">
        <input class="request-game-name" value="${escapeHtml(item.gameName)}" aria-label="게임 이름">
        <button class="button request-approve">승인</button>
        <button class="button subtle request-reject">거절</button>
      </div>` : ""}
    </div>`).join("") : `<div class="empty">후원 요청이 없습니다.</div>`;
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
      await command("game:remove", { id: row.dataset.gameId });
    }
  });
  $("#steam-scan").addEventListener("click", async () => {
    const result = await command("steam:scan");
    showToast(`Steam ${result.found}개 확인: ${result.added}개 추가, ${result.updated}개 갱신`);
  });
  $("#overlay-open").addEventListener("click", () => command("overlay:open"));

  $("#spin").addEventListener("click", () => command("spin"));
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
    showToast(result.action === "ignored" ? "명령 또는 금액 조건에 맞지 않아 반영하지 않았습니다." : `후원 요청: ${result.action}`);
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
      removePrefix: $("#remove-prefix").value
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
}

function updateChzzkStatus(status) {
  $("#chzzk-status").textContent = status.message;
  $("#chzzk-dot").className = `dot ${status.phase === "connected" ? "connected" : status.phase === "error" ? "error" : ""}`;
}

async function initialize() {
  bindEvents();
  render(await window.roulette.getState());
  const summary = await window.roulette.getSecretsSummary();
  $("#client-id").value = summary.clientId;
  $("#chzzk-reconnect").disabled = !summary.hasCredentials;
  window.roulette.onState(render);
  window.roulette.onChzzkStatus(updateChzzkStatus);
}

initialize().catch((error) => showToast(error.message, true));
