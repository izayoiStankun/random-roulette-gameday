const test = require("node:test");
const assert = require("node:assert/strict");
const { findUpcomingSunrise, getSunriseStatus, isValidLocation } = require("../src/main/sunrise");

function fakeCalculator() {
  return {
    getTimes(date) {
      const sunrise = new Date(date);
      sunrise.setHours(5, 30, 0, 0);
      return { sunrise };
    }
  };
}

test("일출 1시간 전부터만 OBS 표시 상태가 켜진다", () => {
  const settings = { sunriseEnabled: true, sunriseLatitude: 37.57, sunriseLongitude: 126.98 };
  const beforeWindow = getSunriseStatus(settings, new Date(2026, 7, 2, 4, 29), fakeCalculator());
  const insideWindow = getSunriseStatus(settings, new Date(2026, 7, 2, 4, 45), fakeCalculator());
  assert.equal(beforeWindow.visible, false);
  assert.equal(insideWindow.visible, true);
  assert.equal(insideWindow.remainingSec, 45 * 60);
});

test("오늘 일출이 지나면 다음 날 일출을 선택한다", () => {
  const now = new Date(2026, 7, 2, 6, 0);
  const sunrise = findUpcomingSunrise(now, 37.57, 126.98, fakeCalculator());
  assert.equal(sunrise.getDate(), 3);
  assert.equal(sunrise.getHours(), 5);
  assert.equal(sunrise.getMinutes(), 30);
});

test("위치 범위를 검증하고 OFF일 때 계산하지 않는다", () => {
  assert.equal(isValidLocation(37.57, 126.98), true);
  assert.equal(isValidLocation(100, 126.98), false);
  const status = getSunriseStatus({ sunriseEnabled: false }, new Date(), {
    getTimes() { throw new Error("OFF 상태에서는 호출되면 안 됩니다."); }
  });
  assert.equal(status.enabled, false);
  assert.equal(status.visible, false);
});
