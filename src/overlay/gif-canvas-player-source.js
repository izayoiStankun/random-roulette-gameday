import { decompressFrames, parseGIF } from "gifuct-js";

const MAX_GIF_BYTES = 32 * 1024 * 1024;
const MAX_FRAMES = 600;
const MAX_DIMENSION = 1024;

function waitForFrame(delay, callback) {
  return setTimeout(() => requestAnimationFrame(callback), Math.max(10, delay));
}

export function createGifCanvasPlayer(canvas) {
  const outputContext = canvas.getContext("2d");
  const compositeCanvas = document.createElement("canvas");
  const compositeContext = compositeCanvas.getContext("2d");
  const patchCanvas = document.createElement("canvas");
  const patchContext = patchCanvas.getContext("2d");
  let generation = 0;
  let timer = null;

  function stop() {
    generation += 1;
    clearTimeout(timer);
    timer = null;
  }

  async function play(url) {
    stop();
    const currentGeneration = generation;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`GIF 요청 실패: HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength || buffer.byteLength > MAX_GIF_BYTES) {
      throw new Error("GIF 파일 크기를 사용할 수 없습니다.");
    }

    const gif = parseGIF(buffer);
    const frames = decompressFrames(gif, true);
    const width = Number(gif?.lsd?.width) || 0;
    const height = Number(gif?.lsd?.height) || 0;
    if (!frames.length || frames.length > MAX_FRAMES || width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
      throw new Error("GIF 프레임 정보를 사용할 수 없습니다.");
    }
    if (currentGeneration !== generation) return;

    compositeCanvas.width = width;
    compositeCanvas.height = height;
    compositeContext.clearRect(0, 0, width, height);
    let frameIndex = 0;
    let clearBeforeNextFrame = false;

    await new Promise((resolve) => {
      function renderFrame() {
        if (currentGeneration !== generation) return resolve();
        const frame = frames[frameIndex];
        const startedAt = performance.now();
        if (clearBeforeNextFrame) {
          compositeContext.clearRect(0, 0, width, height);
          clearBeforeNextFrame = false;
        }

        const { dims } = frame;
        patchCanvas.width = dims.width;
        patchCanvas.height = dims.height;
        const imageData = patchContext.createImageData(dims.width, dims.height);
        imageData.data.set(frame.patch);
        patchContext.putImageData(imageData, 0, 0);
        compositeContext.drawImage(patchCanvas, dims.left, dims.top);

        outputContext.clearRect(0, 0, canvas.width, canvas.height);
        outputContext.drawImage(compositeCanvas, 0, 0, canvas.width, canvas.height);
        clearBeforeNextFrame = frame.disposalType === 2;
        frameIndex += 1;
        if (frameIndex >= frames.length) return resolve();

        const elapsed = performance.now() - startedAt;
        timer = waitForFrame((Number(frame.delay) || 40) - elapsed, renderFrame);
      }

      requestAnimationFrame(renderFrame);
    });
  }

  return { play, stop };
}
