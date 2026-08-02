const STEAM_API_BASE = "https://api.steampowered.com";

function parseSteamProfile(value) {
  const input = String(value || "").trim();
  if (/^\d{17}$/.test(input)) return { steamId: input, vanity: null };

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Steam 프로필 주소 또는 17자리 SteamID64를 입력해 주세요.");
  }
  if (!/(^|\.)steamcommunity\.com$/i.test(url.hostname)) {
    throw new Error("steamcommunity.com 프로필 주소를 입력해 주세요.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0]?.toLowerCase() === "profiles" && /^\d{17}$/.test(parts[1] || "")) {
    return { steamId: parts[1], vanity: null };
  }
  if (parts[0]?.toLowerCase() === "id" && parts[1]) {
    return { steamId: null, vanity: decodeURIComponent(parts[1]) };
  }
  throw new Error("Steam 개인 프로필 주소를 확인해 주세요.");
}

async function requestJson(url, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error("Steam 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.");
    }
    throw new Error("Steam 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("Steam Web API 키가 올바르지 않거나 사용할 수 없습니다.");
  }
  if (!response.ok) {
    throw new Error(`Steam API 요청에 실패했습니다. (HTTP ${response.status})`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Steam API 응답을 읽지 못했습니다.");
  }
}

async function resolveSteamId(profile, apiKey, fetchImpl) {
  const parsed = parseSteamProfile(profile);
  if (parsed.steamId) return parsed.steamId;
  const url = new URL(`${STEAM_API_BASE}/ISteamUser/ResolveVanityURL/v1/`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("vanityurl", parsed.vanity);
  const data = await requestJson(url, fetchImpl);
  if (Number(data?.response?.success) !== 1 || !/^\d{17}$/.test(data?.response?.steamid || "")) {
    throw new Error("해당 Steam 사용자 지정 프로필을 찾지 못했습니다.");
  }
  return data.response.steamid;
}

async function fetchOwnedGames({ apiKey, profile, fetchImpl = globalThis.fetch }) {
  const cleanKey = String(apiKey || "").trim();
  if (!cleanKey) throw new Error("Steam Web API 키를 입력해 주세요.");
  if (typeof fetchImpl !== "function") throw new Error("Steam 웹 요청 기능을 사용할 수 없습니다.");

  const steamId = await resolveSteamId(profile, cleanKey, fetchImpl);
  const url = new URL(`${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v1/`);
  url.searchParams.set("key", cleanKey);
  url.searchParams.set("steamid", steamId);
  url.searchParams.set("include_appinfo", "true");
  url.searchParams.set("include_played_free_games", "true");
  url.searchParams.set("format", "json");
  const data = await requestJson(url, fetchImpl);
  const rawGames = data?.response?.games;
  if (!Array.isArray(rawGames)) {
    throw new Error("보유 게임을 확인할 수 없습니다. Steam 프로필의 '게임 세부 정보'를 공개로 바꿔 주세요.");
  }
  const games = rawGames
    .filter((game) => game?.appid && String(game?.name || "").trim())
    .map((game) => ({
      appId: String(game.appid),
      name: String(game.name).trim(),
      installed: false,
      owned: true
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return { steamId, games };
}

module.exports = { fetchOwnedGames, parseSteamProfile, resolveSteamId };
