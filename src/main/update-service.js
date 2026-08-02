const { EventEmitter } = require("node:events");
const semver = require("semver");

const RELEASES_API = "https://api.github.com/repos/izayoiStankun/random-roulette-gameday/releases";
const RELEASES_PAGE = "https://github.com/izayoiStankun/random-roulette-gameday/releases";

function selectRelease(releases, channel, currentVersion) {
  return releases
    .filter((release) => !release.draft && (channel === "beta" || !release.prerelease))
    .map((release) => ({ ...release, parsedVersion: semver.parse(release.tag_name) }))
    .filter((release) => release.parsedVersion && semver.gt(release.parsedVersion, currentVersion))
    .sort((a, b) => semver.rcompare(a.parsedVersion, b.parsedVersion))[0] || null;
}

class UpdateService extends EventEmitter {
  constructor({ currentVersion, isPackaged, isPortable, updater, openExternal, fetchImpl = global.fetch }) {
    super();
    this.currentVersion = currentVersion;
    this.isPackaged = isPackaged;
    this.isPortable = isPortable;
    this.updater = updater;
    this.openExternal = openExternal;
    this.fetchImpl = fetchImpl;
    this.channel = "latest";
    this.releaseUrl = RELEASES_PAGE;
    this.status = {
      phase: "idle",
      currentVersion,
      availableVersion: null,
      progress: 0,
      isPortable,
      channel: this.channel,
      message: "업데이트를 확인할 수 있습니다."
    };
    this.bindUpdaterEvents();
  }

  bindUpdaterEvents() {
    if (!this.updater) return;
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.on("checking-for-update", () => this.setStatus("checking", "업데이트를 확인하고 있습니다…"));
    this.updater.on("update-available", (info) => {
      this.releaseUrl = `${RELEASES_PAGE}/tag/v${info.version}`;
      this.setStatus("available", `새 버전 ${info.version}을 사용할 수 있습니다.`, {
        availableVersion: info.version,
        progress: 0
      });
    });
    this.updater.on("update-not-available", () => {
      this.setStatus("not-available", "현재 최신 버전입니다.", { availableVersion: null, progress: 0 });
    });
    this.updater.on("download-progress", (progress) => {
      this.setStatus("downloading", `업데이트 다운로드 중 ${Math.round(progress.percent)}%`, {
        progress: Math.round(progress.percent)
      });
    });
    this.updater.on("update-downloaded", (info) => {
      this.setStatus("downloaded", `버전 ${info.version} 다운로드가 끝났습니다. 설치하면 앱이 재시작됩니다.`, {
        availableVersion: info.version,
        progress: 100
      });
    });
    this.updater.on("error", (error) => this.setError(error));
  }

  snapshot() {
    return { ...this.status };
  }

  setStatus(phase, message, patch = {}) {
    this.status = {
      ...this.status,
      ...patch,
      phase,
      message,
      channel: this.channel,
      isPortable: this.isPortable
    };
    this.emit("status", this.snapshot());
    return this.snapshot();
  }

  setError(error) {
    return this.setStatus("error", `업데이트 확인에 실패했습니다: ${error.message || error}`);
  }

  setChannel(channel) {
    this.channel = channel === "beta" ? "beta" : "latest";
    if (this.updater) {
      this.updater.channel = this.channel;
      this.updater.allowPrerelease = this.channel === "beta";
      this.updater.allowDowngrade = false;
    }
    return this.setStatus("idle", this.channel === "beta"
      ? "테스트 버전까지 업데이트를 확인합니다."
      : "정식 버전만 업데이트를 확인합니다.", {
      availableVersion: null,
      progress: 0
    });
  }

  async check() {
    if (!this.isPackaged) {
      return this.setStatus("unsupported", "개발 실행에서는 업데이트 확인을 생략합니다.");
    }
    try {
      if (this.isPortable) return await this.checkPortable();
      if (!this.updater) throw new Error("설치형 업데이트 모듈을 불러오지 못했습니다.");
      await this.updater.checkForUpdates();
      return this.snapshot();
    } catch (error) {
      return this.setError(error);
    }
  }

  async checkPortable() {
    this.setStatus("checking", "업데이트를 확인하고 있습니다…");
    const response = await this.fetchImpl(RELEASES_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "random-roulette-gameday"
      }
    });
    if (!response.ok) throw new Error(`GitHub 응답 ${response.status}`);
    const release = selectRelease(await response.json(), this.channel, this.currentVersion);
    if (!release) {
      return this.setStatus("not-available", "현재 최신 버전입니다.", {
        availableVersion: null,
        progress: 0
      });
    }
    this.releaseUrl = release.html_url || `${RELEASES_PAGE}/tag/${release.tag_name}`;
    return this.setStatus("available", `새 버전 ${release.parsedVersion.version}을 사용할 수 있습니다.`, {
      availableVersion: release.parsedVersion.version,
      progress: 0
    });
  }

  async download() {
    if (this.status.phase !== "available") throw new Error("먼저 업데이트를 확인해 주세요.");
    if (this.isPortable) {
      await this.openRelease();
      return this.setStatus("available", "포터블판은 다운로드 페이지에서 새 EXE를 받아 교체해 주세요.");
    }
    await this.updater.downloadUpdate();
    return this.snapshot();
  }

  install() {
    if (this.isPortable || this.status.phase !== "downloaded") {
      throw new Error("설치할 업데이트가 준비되지 않았습니다.");
    }
    this.updater.quitAndInstall(false, true);
    return { ok: true };
  }

  async openRelease() {
    await this.openExternal(this.releaseUrl || RELEASES_PAGE);
    return { ok: true };
  }
}

module.exports = { RELEASES_API, RELEASES_PAGE, UpdateService, selectRelease };
