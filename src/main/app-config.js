const DEFAULT_OVERLAY_PORT = 17554;
const LOCAL_CHZZK_CALLBACK_URI = `http://127.0.0.1:${DEFAULT_OVERLAY_PORT}/oauth/callback`;
const HOSTED_CHZZK_CALLBACK_URI = "https://sadoloverme.xyz/chzzk/callback/";

function resolveChzzkRedirectUri(value = process.env.ROULETTE_CHZZK_REDIRECT_URI) {
  const candidate = String(value || "").trim();
  if (!candidate) return LOCAL_CHZZK_CALLBACK_URI;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("치지직 로그인 리디렉션 URL이 올바르지 않습니다.");
  }
  const isLoopbackHttp = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLoopbackHttp) {
    throw new Error("치지직 로그인 리디렉션 URL은 HTTPS 또는 로컬 주소여야 합니다.");
  }
  return url.toString();
}

module.exports = {
  DEFAULT_OVERLAY_PORT,
  HOSTED_CHZZK_CALLBACK_URI,
  LOCAL_CHZZK_CALLBACK_URI,
  resolveChzzkRedirectUri
};
