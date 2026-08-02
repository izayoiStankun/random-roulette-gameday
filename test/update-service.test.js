const test = require("node:test");
const assert = require("node:assert/strict");
const { UpdateService, selectRelease } = require("../src/main/update-service");

const RELEASES = [
  { tag_name: "v0.1.1", draft: false, prerelease: false, html_url: "stable-old" },
  { tag_name: "v0.2.0-beta.1", draft: false, prerelease: true, html_url: "beta-one" },
  { tag_name: "v0.2.0-beta.2", draft: false, prerelease: true, html_url: "beta-two" },
  { tag_name: "v9.0.0", draft: true, prerelease: false, html_url: "draft" }
];

test("stable channel ignores prereleases and drafts", () => {
  assert.equal(selectRelease(RELEASES, "latest", "0.1.0").tag_name, "v0.1.1");
  assert.equal(selectRelease(RELEASES, "latest", "0.1.1"), null);
});

test("beta channel selects the newest compatible prerelease", () => {
  assert.equal(selectRelease(RELEASES, "beta", "0.2.0-beta.1").tag_name, "v0.2.0-beta.2");
});

test("portable builds report a release and open its page", async () => {
  const opened = [];
  const service = new UpdateService({
    currentVersion: "0.2.0-beta.1",
    isPackaged: true,
    isPortable: true,
    updater: null,
    openExternal: async (url) => opened.push(url),
    fetchImpl: async () => ({ ok: true, json: async () => RELEASES })
  });
  service.setChannel("beta");

  const status = await service.check();
  assert.equal(status.phase, "available");
  assert.equal(status.availableVersion, "0.2.0-beta.2");

  await service.download();
  assert.deepEqual(opened, ["beta-two"]);
});

test("development runs never contact the update server", async () => {
  const service = new UpdateService({
    currentVersion: "0.2.0-beta.1",
    isPackaged: false,
    isPortable: false,
    updater: null,
    openExternal: async () => {},
    fetchImpl: async () => { throw new Error("must not be called"); }
  });

  assert.equal((await service.check()).phase, "unsupported");
});
