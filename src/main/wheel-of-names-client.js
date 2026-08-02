const API_URL = "https://wheelofnames.com/api/v3/wheels/animate";

function createWheelEntries(context) {
  const totalSlots = context.games.reduce((sum, game) => sum + game.slots, 0);
  const gamesWeight = 100 - context.chanceUsed;
  const entries = context.games.map((game) => ({
    id: game.id,
    text: game.name,
    weight: game.slots / totalSlots * gamesWeight
  })).filter((entry) => entry.weight > 0);
  if (context.chanceUsed > 0) {
    entries.unshift({ id: "end", text: "방종", weight: context.chanceUsed, color: "#EF334F" });
  }
  return entries;
}

async function createSpinAnimation({ apiKey, context, fetchImpl = globalThis.fetch }) {
  const cleanKey = String(apiKey || "").trim();
  if (!cleanKey) throw new Error("Wheel of Names API 키를 입력해 주세요.");
  if (!context?.games?.length) throw new Error("룰렛에 넣을 게임이 없습니다.");
  if (typeof fetchImpl !== "function") throw new Error("Wheel of Names 웹 요청 기능을 사용할 수 없습니다.");
  const entries = createWheelEntries(context);
  let response;
  try {
    response = await fetchImpl(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cleanKey
      },
      body: JSON.stringify({
        wheelConfig: {
          title: "랜덤룰렛게임데이",
          showTitle: false,
          displayWinnerDialog: false,
          animateWinner: true,
          isAdvanced: true,
          spinTime: 6,
          pageBackgroundColor: "#071620",
          entries
        },
        imageFormat: "webp",
        size: 360,
        fps: 24,
        loop: false,
        webpQuality: 90
      }),
      signal: AbortSignal.timeout(30000)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error("Wheel of Names 응답 시간이 초과되었습니다.");
    }
    throw new Error("Wheel of Names 서버에 연결하지 못했습니다.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("Wheel of Names API 키가 올바르지 않거나 사용할 수 없습니다.");
  }
  if (!response.ok) {
    throw new Error(`Wheel of Names 요청에 실패했습니다. (HTTP ${response.status})`);
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Wheel of Names 응답을 읽지 못했습니다.");
  }
  const winnerId = String(data?.winner?.id || "");
  if (!entries.some((entry) => entry.id === winnerId)) {
    throw new Error("Wheel of Names 당첨 결과가 현재 목록과 일치하지 않습니다.");
  }
  const animation = Buffer.from(String(data?.animation || ""), "base64");
  if (!animation.length || animation.length > 32 * 1024 * 1024) {
    throw new Error("Wheel of Names 회전 영상을 사용할 수 없습니다.");
  }
  return { winnerId, animation, contentType: "image/webp" };
}

module.exports = { API_URL, createSpinAnimation, createWheelEntries };
