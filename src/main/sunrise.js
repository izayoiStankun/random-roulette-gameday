const SunCalc = require("suncalc");

const ONE_HOUR_MS = 60 * 60 * 1000;

function isValidLocation(latitude, longitude) {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function findUpcomingSunrise(now, latitude, longitude, calculator = SunCalc) {
  const candidates = [];
  for (let dayOffset = 0; dayOffset <= 3; dayOffset += 1) {
    const candidateDate = new Date(now);
    candidateDate.setDate(candidateDate.getDate() + dayOffset);
    const sunrise = calculator.getTimes(candidateDate, latitude, longitude).sunrise;
    if (sunrise instanceof Date && Number.isFinite(sunrise.getTime()) && sunrise > now) {
      candidates.push(sunrise);
    }
  }
  candidates.sort((a, b) => a - b);
  return candidates[0] || null;
}

function getSunriseStatus(settings, now = new Date(), calculator = SunCalc) {
  const hasLocation = settings.sunriseLatitude !== null && settings.sunriseLatitude !== "" &&
    settings.sunriseLongitude !== null && settings.sunriseLongitude !== "";
  const latitude = Number(settings.sunriseLatitude);
  const longitude = Number(settings.sunriseLongitude);
  if (!settings.sunriseEnabled) {
    return { enabled: false, configured: false, visible: false, sunriseAt: null, remainingSec: null };
  }
  if (!hasLocation || !isValidLocation(latitude, longitude)) {
    return { enabled: true, configured: false, visible: false, sunriseAt: null, remainingSec: null };
  }
  const sunrise = findUpcomingSunrise(now, latitude, longitude, calculator);
  if (!sunrise) {
    return { enabled: true, configured: true, visible: false, sunriseAt: null, remainingSec: null };
  }
  const remainingMs = sunrise.getTime() - now.getTime();
  return {
    enabled: true,
    configured: true,
    visible: remainingMs > 0 && remainingMs <= ONE_HOUR_MS,
    sunriseAt: sunrise.toISOString(),
    remainingSec: Math.max(0, Math.ceil(remainingMs / 1000))
  };
}

module.exports = { ONE_HOUR_MS, findUpcomingSunrise, getSunriseStatus, isValidLocation };
