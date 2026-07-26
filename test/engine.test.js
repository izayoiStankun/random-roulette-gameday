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

test("자동 모드는 확인된 게임 요청만 즉시 반영한다", () => {
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
  assert.equal(unknown.action, "queued");
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
});
