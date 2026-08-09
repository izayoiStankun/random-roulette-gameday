const OVERLAY_VIEW_LAYERS = Object.freeze({
  all: Object.freeze(["wheel", "hud", "roster", "donation", "sunrise", "end"]),
  wheel: Object.freeze(["wheel"]),
  hud: Object.freeze(["hud"]),
  roster: Object.freeze(["roster"]),
  donation: Object.freeze(["donation"]),
  sunrise: Object.freeze(["sunrise"]),
  end: Object.freeze(["end"]),
  audio: Object.freeze([])
});

function resolveOverlayView(search = "") {
  const params = new URLSearchParams(String(search).replace(/^\?/, ""));
  const requestedView = params.get("view") || "all";
  const view = Object.hasOwn(OVERLAY_VIEW_LAYERS, requestedView) ? requestedView : "all";
  return {
    view,
    layers: [...OVERLAY_VIEW_LAYERS[view]],
    playsAudio: view === "audio" || (view === "all" && params.get("audio") !== "off")
  };
}

const overlayViewMode = { OVERLAY_VIEW_LAYERS, resolveOverlayView };

if (typeof window !== "undefined") window.OverlayViewMode = overlayViewMode;
if (typeof module !== "undefined" && module.exports) module.exports = overlayViewMode;
