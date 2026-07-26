const fs = require("node:fs");
const path = require("node:path");
const { safeStorage } = require("electron");

class JsonStore {
  constructor(directory) {
    this.directory = directory;
    this.statePath = path.join(directory, "state.json");
    this.secretPath = path.join(directory, "secrets.bin");
    fs.mkdirSync(directory, { recursive: true });
  }

  readState() {
    try {
      return JSON.parse(fs.readFileSync(this.statePath, "utf8"));
    } catch {
      return {};
    }
  }

  writeState(value) {
    const temporaryPath = `${this.statePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(temporaryPath, this.statePath);
  }

  readSecrets() {
    try {
      if (!safeStorage.isEncryptionAvailable()) return {};
      const encrypted = fs.readFileSync(this.secretPath);
      return JSON.parse(safeStorage.decryptString(encrypted));
    } catch {
      return {};
    }
  }

  writeSecrets(value) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Windows 보안 저장소를 사용할 수 없어 인증 정보를 저장하지 않았습니다.");
    }
    fs.writeFileSync(this.secretPath, safeStorage.encryptString(JSON.stringify(value)));
  }
}

module.exports = { JsonStore };
