const test = require("node:test");
const assert = require("node:assert/strict");
const { RouletteEngine } = require("../src/main/engine");

function sequence(values) {
  let index = 0;
  return () => values[index++] ?? values[values.length - 1] ?? 0.5;
}

test("방종 칸은 4회차부터 시작 확률로 등장한다", () => {
  const engine = new RouletteEngine({}, sequence([
    0, 0, // round 1: end roll, game roll
    0, 0, // round 2
    0, 0, // round 3
    0.04  // round 4: 4% is within 5%
  ]));
  engine.addGame("테스트 게임");
  for (let round = 1; round <= 3; round += 1) {
    const spin = engine.beginSpin();
    assert.equal(spin.resultType, "game");
    assert.equal(spin.chanceUsed, 0);
    engine.finalizeSpin(spin.id);
    engine.finishGameEarly();
  }
  const fourth = engine.beginSpin();
  assert.equal(fourth.resultType, "end");
  assert.equal(fourth.chanceUsed, 5);
});

test("방종 실패 후 증감값을 반영하되 최저 3%를 지킨다", () => {
  const engine = new RouletteEngine(
    { round: 3, settings: { endChanceStart: 5, endChanceMin: 3, endDeltaMin: -5, endDeltaMax: -5 } },
    sequence([0.9, 0, 0])
  );
  engine.addGame("테스트 게임");
  const spin = engine.beginSpin();
  assert.equal(spin.resultType, "game");
  engine.finalizeSpin(spin.id);
  assert.equal(engine.endChance, 3);
  assert.equal(engine.history[0].endChanceDelta, -5);
});

test("수동 모드는 후원 게임 추가를 승인 대기시킨다", () => {
  const engine = new RouletteEngine();
  const result = engine.ingestDonation({
    donatorNickname: "시청자",
    payAmount: "2500",
    donationText: "새 게임 추가요"
  });
  assert.equal(result.action, "queued");
  assert.equal(result.request.slots, 2);
  engine.resolveRequest(result.request.id, "approve");
  assert.equal(engine.findGame("새 게임").slots, 2);
});

test("명령 없는 일반 후원 메시지를 게임 이름으로 추가 요청한다", () => {
  const engine = new RouletteEngine();
  const result = engine.ingestDonation({
    donatorNickname: "시청자",
    payAmount: "5000",
    donationText: "HANS"
  });
  assert.equal(result.action, "queued");
  assert.equal(result.request.kind, "add");
  assert.equal(result.request.gameName, "HANS");
  assert.equal(result.request.slots, 5);
});

test("자동 모드는 보유 여부와 관계없이 게임 추가 요청을 즉시 반영한다", () => {
  const engine = new RouletteEngine({ settings: { mode: "auto" } });
  engine.addGame("보유 게임", { owned: true });
  const known = engine.ingestDonation({
    donatorNickname: "시청자",
    payAmount: "3000",
    donationText: "!게임추가 보유 게임"
  });
  const unknown = engine.ingestDonation({
    donatorNickname: "시청자",
    payAmount: "1000",
    donationText: "!게임추가 미확인 게임"
  });
  assert.equal(known.action, "applied");
  assert.equal(engine.findGame("보유 게임").slots, 4);
  assert.equal(unknown.action, "applied");
  assert.equal(engine.findGame("미확인 게임").slots, 1);
  assert.equal(engine.queue.length, 0);
});

test("자동 모드에서도 목록에 없는 게임 제거 요청은 승인 대기시킨다", () => {
  const engine = new RouletteEngine({ settings: { mode: "auto" } });
  const result = engine.ingestDonation({
    donatorNickname: "시청자",
    payAmount: "2000",
    donationText: "!게임빼기 없는 게임"
  });
  assert.equal(result.action, "queued");
  assert.equal(engine.queue.length, 1);
  assert.equal(engine.findGame("없는 게임"), undefined);
});

test("설정한 제외 문구가 있는 후원은 룰렛 요청에 반영하지 않는다", () => {
  const engine = new RouletteEngine({ settings: { donationExcludeKeywords: "룰렛제외, 게임추가금지" } });
  const result = engine.ingestDonation({
    donatorNickname: "시청자",
    payAmount: "5000",
    donationText: "새 게임 추가요 룰렛제외"
  });
  assert.equal(result.action, "ignored");
  assert.equal(result.reason, "excluded-message");
  assert.equal(engine.queue.length, 0);
  assert.equal(engine.games.length, 0);
});

test("외부 룰렛 당첨 결과를 확정하고 ON이면 당첨 게임을 목록에서 삭제한다", () => {
  const engine = new RouletteEngine({ settings: { removeWinnerAfterSpin: true } });
  const game = engine.addGame("삭제될 게임");
  const context = engine.prepareSpin();
  const spin = engine.beginPreparedSpin(context, game.id, { provider: "wheelofnames", animationVersion: "123" });
  assert.equal(spin.provider, "wheelofnames");
  assert.equal(spin.resultName, "삭제될 게임");
  engine.finalizeSpin(spin.id);
  assert.equal(engine.currentGame.name, "삭제될 게임");
  assert.equal(engine.games.length, 0);
});

test("게임 제거는 2000원당 한 칸이다", () => {
  const engine = new RouletteEngine();
  engine.addGame("경쟁 게임", { slots: 5 });
  const result = engine.ingestDonation({
    donatorNickname: "시청자",
    payAmount: "4500",
    donationText: "!게임빼기 경쟁 게임"
  });
  assert.equal(result.request.slots, 2);
  engine.resolveRequest(result.request.id, "approve");
  assert.equal(engine.findGame("경쟁 게임").slots, 3);
});

test("타이머 만료 시 다음 룰렛 대기 상태가 된다", () => {
  const engine = new RouletteEngine({ settings: { roundDurationSec: 10 } }, sequence([0.5, 0]));
  engine.addGame("타이머 게임");
  const spin = engine.beginSpin();
  engine.finalizeSpin(spin.id);
  engine.startTimer();
  engine.tick(engine.timer.endsAt + 1);
  assert.equal(engine.status, "awaiting_spin");
  assert.equal(engine.timer.remainingSec, 0);
  assert.equal(engine.cue.type, "timer-ended");
});

test("타이머는 종료 4초 전에 카운트다운 큐를 한 번 만든다", () => {
  const engine = new RouletteEngine({ settings: { roundDurationSec: 10 } }, sequence([0.5, 0]));
  engine.addGame("카운트다운 게임");
  const spin = engine.beginSpin();
  engine.finalizeSpin(spin.id);
  engine.startTimer();
  engine.tick(engine.timer.endsAt - 4000);
  const cueId = engine.cue.id;
  assert.equal(engine.cue.type, "countdown");
  engine.tick(engine.timer.endsAt - 3000);
  assert.equal(engine.cue.id, cueId);
});

test("조기 종료에는 종료 알람 큐를 만들지 않는다", () => {
  const engine = new RouletteEngine({}, sequence([0.5, 0]));
  engine.addGame("조기 종료 게임");
  const spin = engine.beginSpin();
  engine.finalizeSpin(spin.id);
  engine.startTimer();
  engine.finishGameEarly();
  assert.equal(engine.status, "awaiting_spin");
  assert.equal(engine.cue, null);
});

test("알림음 출력과 볼륨 설정을 정규화한다", () => {
  const engine = new RouletteEngine();
  engine.updateSettings({ soundOutput: "overlay", soundVolume: 130 });
  assert.equal(engine.settings.soundOutput, "overlay");
  assert.equal(engine.settings.soundVolume, 100);
  engine.updateSettings({ soundOutput: "invalid", soundVolume: -4 });
  assert.equal(engine.settings.soundOutput, "app");
  assert.equal(engine.settings.soundVolume, 0);
});

test("직접 추가의 엔진 기본값은 1칸이다", () => {
  const engine = new RouletteEngine();
  engine.addGame("기본 게임");
  assert.equal(engine.findGame("기본 게임").slots, 1);
});

test("일출 위치 좌표는 UI와 OBS 상태에 노출하지 않는다", () => {
  const engine = new RouletteEngine();
  engine.updateSettings({
    sunriseEnabled: true,
    sunriseLatitude: 37.57,
    sunriseLongitude: 126.98
  });
  assert.equal(engine.settings.sunriseLatitude, 37.57);
  assert.equal(Object.hasOwn(engine.snapshot().settings, "sunriseLatitude"), false);
  assert.equal(Object.hasOwn(engine.persistentSnapshot().settings, "sunriseLongitude"), false);
  assert.equal(engine.snapshot().sunrise.configured, true);
});

test("다음 룰렛 확률은 4회차부터 방종을 포함해 합계 100%가 된다", () => {
  const early = new RouletteEngine({ round: 2 });
  assert.deepEqual(early.snapshot().probability, { round: 3, endChance: 0, gamesChance: 100 });

  const fourth = new RouletteEngine({ round: 3, settings: { endChanceStart: 5 } });
  assert.deepEqual(fourth.snapshot().probability, { round: 4, endChance: 5, gamesChance: 95 });

  const later = new RouletteEngine({ round: 4, endChance: 9 });
  assert.deepEqual(later.snapshot().probability, { round: 5, endChance: 9, gamesChance: 91 });
});

test("선택 삭제·전체 초기화·백업 복원용 목록 교체가 동작한다", () => {
  const engine = new RouletteEngine();
  const first = engine.addGame("첫 게임");
  engine.addGame("둘째 게임");
  assert.equal(engine.removeGames([first.id]), 1);
  assert.equal(engine.games.length, 1);
  assert.equal(engine.clearGames(), 1);
  assert.equal(engine.games.length, 0);
  assert.equal(engine.replaceGames([{ name: "복원 게임", slots: 7, enabled: true }]), 1);
  assert.equal(engine.findGame("복원 게임").slots, 7);
});
