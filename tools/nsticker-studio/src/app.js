const MAX_PACKAGE_BYTES = 8 * 1024 * 1024;
const MIN_DURATION_MS = 100;
const MAX_DURATION_MS = 10000;
const IMAGE_EXTENSIONS = new Set(["webp", "png", "gif"]);
const AUDIO_EXTENSIONS = new Set(["m4a", "mp3", "ogg"]);

const dom = {
  packageName: byId("packageName"),
  engineStatus: byId("engineStatus"),
  resetButton: byId("resetButton"),
  imageInput: byId("imageInput"),
  imageDrop: byId("imageDrop"),
  imageName: byId("imageName"),
  imageOutput: byId("imageOutput"),
  fitMode: byId("fitMode"),
  canvasSize: byId("canvasSize"),
  backgroundColor: byId("backgroundColor"),
  transparentBg: byId("transparentBg"),
  audioInput: byId("audioInput"),
  audioDrop: byId("audioDrop"),
  audioName: byId("audioName"),
  playAudioButton: byId("playAudioButton"),
  waveformCanvas: byId("waveformCanvas"),
  playbackTrack: byId("playbackTrack"),
  playbackBar: byId("playbackBar"),
  playbackCurrent: byId("playbackCurrent"),
  playbackTotal: byId("playbackTotal"),
  trimStartRange: byId("trimStartRange"),
  trimEndRange: byId("trimEndRange"),
  trimStart: byId("trimStart"),
  trimEnd: byId("trimEnd"),
  durationMs: byId("durationMs"),
  audioOffset: byId("audioOffset"),
  fadeIn: byId("fadeIn"),
  fadeOut: byId("fadeOut"),
  normalizeAudio: byId("normalizeAudio"),
  includeAudio: byId("includeAudio"),
  fitAudioButton: byId("fitAudioButton"),
  audioOutput: byId("audioOutput"),
  audioBitrate: byId("audioBitrate"),
  exportButton: byId("exportButton"),
  addToPackButton: byId("addToPackButton"),
  validationList: byId("validationList"),
  manifestPreview: byId("manifestPreview"),
  durationMetric: byId("durationMetric"),
  audioMetric: byId("audioMetric"),
  sizeMetric: byId("sizeMetric"),
  imagePreview: byId("imagePreview"),
  emptyPreview: byId("emptyPreview"),
  previewSoundButton: byId("previewSoundButton"),
  statusLog: byId("statusLog"),
  progressBar: byId("progressBar")
};

const state = {
  imageFile: null,
  imageUrl: "",
  imageMeta: null,
  audioFile: null,
  audioUrl: "",
  audioBuffer: null,
  audioElement: null,
  audioDuration: 0,
  trimStart: 0,
  trimEnd: 0,
  lastPackageSize: 0,
  ffmpeg: null,
  ffmpegReady: false,
  exporting: false
};

wireEvents();
resizeWaveform();
render();

function requiresHttpRuntime() {
  return window.location.protocol === "file:";
}

function byId(id) {
  return document.getElementById(id);
}

function wireEvents() {
  dom.imageInput.addEventListener("change", event => {
    const file = event.target.files?.[0];
    if (file) loadImageFile(file);
  });
  dom.audioInput.addEventListener("change", event => {
    const file = event.target.files?.[0];
    if (file) loadAudioFile(file);
  });

  bindDropZone(dom.imageDrop, dom.imageInput, file => loadImageFile(file), IMAGE_EXTENSIONS);
  bindDropZone(dom.audioDrop, dom.audioInput, file => loadAudioFile(file), AUDIO_EXTENSIONS);

  [
    dom.packageName,
    dom.imageOutput,
    dom.fitMode,
    dom.canvasSize,
    dom.backgroundColor,
    dom.transparentBg,
    dom.durationMs,
    dom.audioOffset,
    dom.fadeIn,
    dom.fadeOut,
    dom.normalizeAudio,
    dom.includeAudio,
    dom.audioOutput,
    dom.audioBitrate
  ].forEach(element => element.addEventListener("input", render));

  [dom.trimStart, dom.trimStartRange].forEach(element => {
    element.addEventListener("input", () => setTrimStart(Number(element.value)));
  });
  [dom.trimEnd, dom.trimEndRange].forEach(element => {
    element.addEventListener("input", () => setTrimEnd(Number(element.value)));
  });

  dom.playAudioButton.addEventListener("click", previewAudio);
  dom.previewSoundButton.addEventListener("click", previewAudio);
  dom.fitAudioButton.addEventListener("click", fitAudioToSticker);
  dom.exportButton.addEventListener("click", exportNSticker);
  dom.addToPackButton?.addEventListener("click", addPackageToPack);
  dom.resetButton.addEventListener("click", resetProject);

  window.addEventListener("resize", debounce(resizeWaveform, 80));
}

function bindDropZone(element, input, onFile, allowedExtensions) {
  element.addEventListener("click", event => {
    if (event.target instanceof HTMLInputElement) return;
    input.click();
  });
  element.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });

  ["dragenter", "dragover"].forEach(eventName => {
    element.addEventListener(eventName, event => {
      event.preventDefault();
      element.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach(eventName => {
    element.addEventListener(eventName, event => {
      event.preventDefault();
      element.classList.remove("dragover");
    });
  });

  element.addEventListener("drop", event => {
    const file = [...(event.dataTransfer?.files || [])].find(item => {
      return allowedExtensions.has(extensionOf(item.name));
    });
    if (file) {
      onFile(file);
    } else {
      setStatus("Formato no compatible para esta zona.", "warn");
    }
  });
}

async function loadImageFile(file) {
  const extension = extensionOf(file.name);
  if (!IMAGE_EXTENSIONS.has(extension)) {
    setStatus("La imagen debe ser WEBP, PNG o GIF.", "error");
    return;
  }

  revokeUrl("imageUrl");
  state.imageFile = file;
  state.imageUrl = URL.createObjectURL(file);
  state.imageMeta = await readImageMeta(state.imageUrl).catch(() => null);

  dom.imagePreview.src = state.imageUrl;
  dom.imagePreview.style.display = "block";
  dom.emptyPreview.style.display = "none";
  dom.imageName.textContent = file.name;
  if (dom.packageName.value === "netsus_sound_sticker") {
    dom.packageName.value = safeBaseName(file.name);
  }
  setStatus("Imagen cargada.");
  render();
}

async function loadAudioFile(file) {
  const extension = extensionOf(file.name);
  if (!AUDIO_EXTENSIONS.has(extension)) {
    setStatus("El audio debe ser M4A, MP3 u OGG.", "error");
    return;
  }

  revokeUrl("audioUrl");
  state.audioFile = file;
  state.audioUrl = URL.createObjectURL(file);
  state.audioElement = new Audio(state.audioUrl);
  state.audioElement.preload = "auto";
  state.audioElement.load();
  state.audioBuffer = null;
  state.audioDuration = 0;

  const bytes = await file.arrayBuffer();
  const decoded = await decodeAudio(bytes).catch(() => null);
  if (decoded) {
    state.audioBuffer = decoded;
    state.audioDuration = decoded.duration;
  } else {
    await waitForMediaMetadata(state.audioElement).catch(() => null);
    state.audioDuration = Number.isFinite(state.audioElement.duration) ? state.audioElement.duration : 0;
  }

  state.trimStart = 0;
  state.trimEnd = state.audioDuration || stickerDurationSeconds();
  syncTrimControls();
  dom.audioName.textContent = file.name;
  setStatus("Audio cargado.");
  render();
}

async function decodeAudio(arrayBuffer) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  const context = new AudioContextClass();
  try {
    return await context.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    context.close?.();
  }
}

function waitForMediaMetadata(media) {
  return new Promise((resolve, reject) => {
    const done = () => resolve();
    const fail = () => reject(new Error("No se pudo leer la duración del audio."));
    media.addEventListener("loadedmetadata", done, { once: true });
    media.addEventListener("error", fail, { once: true });
  });
}

function readImageMeta(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = url;
  });
}

function setTrimStart(value) {
  const max = Math.max(0, state.trimEnd - 0.01);
  state.trimStart = clamp(value, 0, max);
  syncTrimControls();
  render();
}

function setTrimEnd(value) {
  const max = state.audioDuration || stickerDurationSeconds();
  state.trimEnd = clamp(value, state.trimStart + 0.01, max);
  syncTrimControls();
  render();
}

function fitAudioToSticker() {
  if (!state.audioFile) return;
  const duration = stickerDurationSeconds();
  state.trimStart = 0;
  state.trimEnd = Math.min(state.audioDuration || duration, duration);
  dom.audioOffset.value = "0";
  syncTrimControls();
  render();
}

function syncTrimControls() {
  const max = Math.max(0.01, state.audioDuration || stickerDurationSeconds());
  [dom.trimStartRange, dom.trimEndRange].forEach(input => {
    input.max = String(max);
    input.disabled = !state.audioFile;
  });
  [dom.trimStart, dom.trimEnd].forEach(input => {
    input.max = String(max);
    input.disabled = !state.audioFile;
  });
  dom.trimStart.value = formatSecondsInput(state.trimStart);
  dom.trimStartRange.value = formatSecondsInput(state.trimStart);
  dom.trimEnd.value = formatSecondsInput(state.trimEnd);
  dom.trimEndRange.value = formatSecondsInput(state.trimEnd);
}

async function previewAudio() {
  if (!state.audioElement || !state.audioFile) return;
  try {
    await ensureAudioElementReady();
    const start = Math.max(0, state.trimStart + Math.max(0, -audioOffsetSeconds()));
    state.audioElement.pause();
    state.audioElement.currentTime = start;
    await state.audioElement.play();

    const stopAt = Math.min(state.trimEnd, start + Math.max(0.05, stickerDurationSeconds()));
    const stopTimer = window.setInterval(() => {
      if (!state.audioElement || state.audioElement.currentTime >= stopAt || state.audioElement.paused) {
        window.clearInterval(stopTimer);
        state.audioElement?.pause();
      }
    }, 50);
    setStatus("Reproduciendo vista previa.");
  } catch (error) {
    console.error(error);
    setStatus("No se pudo reproducir la pista. Prueba otro formato de audio o recarga la pagina.", "error");
  }
}

async function ensureAudioElementReady() {
  if (!state.audioElement) throw new Error("No audio loaded");
  if (state.audioElement.readyState >= HTMLMediaElement.HAVE_METADATA) return;
  state.audioElement.load();
  await waitForMediaMetadata(state.audioElement);
}

async function buildPackageBlob() {
  setStatus("Preparando imagen...");
  const imageAsset = await prepareImageAsset();
  setProgress(0.25);

  let audioAsset = null;
  if (state.audioFile && dom.includeAudio.checked) {
    if (requiresHttpRuntime()) {
      throw new Error("Para procesar audio abre la herramienta con npm start y usa http://localhost:4177. Chrome no permite FFmpeg desde file://.");
    }
    setStatus("Procesando audio...");
    audioAsset = await prepareAudioAsset();
  }
  setProgress(0.82);

  const manifest = buildManifest(imageAsset, audioAsset);
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file(imageAsset.name, imageAsset.bytes);
  if (audioAsset) zip.file(audioAsset.name, audioAsset.bytes);

  setStatus("Creando paquete...");
  const packageBlob = await zip.generateAsync(
    { type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
    metadata => setProgress(0.82 + metadata.percent * 0.0016)
  );
  state.lastPackageSize = packageBlob.size;
  return packageBlob;
}

function startPackageBuild() {
  if (state.exporting) return false;
  const validation = validateProject();
  if (validation.some(item => item.level === "error")) {
    renderValidation(validation);
    setStatus("Corrige los errores antes de exportar.", "error");
    return false;
  }
  state.exporting = true;
  setProgress(0.05);
  dom.exportButton.disabled = true;
  if (dom.addToPackButton) dom.addToPackButton.disabled = true;
  return true;
}

function finishPackageBuild() {
  state.exporting = false;
  setTimeout(() => setProgress(0), 900);
  render();
}

async function exportNSticker() {
  if (!startPackageBuild()) return;
  try {
    const packageBlob = await buildPackageBlob();
    downloadBlob(packageBlob, `${safeBaseName(dom.packageName.value) || "netsus_sticker"}.nsticker`);
    setProgress(1);
    setStatus("Sticker exportado.");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "No se pudo exportar el sticker.", "error");
  } finally {
    finishPackageBuild();
  }
}

async function addPackageToPack() {
  if (!window.NetsusPacks?.addBlobToPack) {
    setStatus("La gestión de paquetes no está disponible en esta página.", "error");
    return;
  }
  if (!startPackageBuild()) return;
  try {
    const packageBlob = await buildPackageBlob();
    setProgress(1);
    setStatus("Elige el paquete de destino.");
    await window.NetsusPacks.addBlobToPack(
      packageBlob,
      `${safeBaseName(dom.packageName.value) || "netsus_sticker"}.nsticker`
    );
  } catch (error) {
    console.error(error);
    setStatus(error.message || "No se pudo agregar el sticker al paquete.", "error");
  } finally {
    finishPackageBuild();
  }
}

async function prepareImageAsset() {
  const imageFile = state.imageFile;
  if (!imageFile) throw new Error("Falta la imagen.");

  const originalExtension = extensionOf(imageFile.name);
  const requested = dom.imageOutput.value;
  if (requested === "preserve") {
    return {
      name: `sticker.${originalExtension}`,
      bytes: new Uint8Array(await imageFile.arrayBuffer()),
      mimeType: imageMimeForExtension(originalExtension)
    };
  }

  const image = await loadImageElement(state.imageUrl);
  const size = Number(dom.canvasSize.value) || 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo crear el lienzo de imagen.");

  if (!dom.transparentBg.checked) {
    context.fillStyle = dom.backgroundColor.value;
    context.fillRect(0, 0, size, size);
  }

  drawImageToSquare(context, image, size, dom.fitMode.value);
  const mimeType = requested === "png" ? "image/png" : "image/webp";
  const blob = await canvasToBlob(canvas, mimeType, 0.92);
  const finalExtension = requested === "png" ? "png" : "webp";

  return {
    name: `sticker.${finalExtension}`,
    bytes: new Uint8Array(await blob.arrayBuffer()),
    mimeType
  };
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function drawImageToSquare(context, image, size, fitMode) {
  if (fitMode === "stretch") {
    context.drawImage(image, 0, 0, size, size);
    return;
  }

  const sourceRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = 1;
  let drawWidth = size;
  let drawHeight = size;
  let x = 0;
  let y = 0;

  if (fitMode === "cover") {
    if (sourceRatio > targetRatio) {
      drawHeight = size;
      drawWidth = size * sourceRatio;
      x = (size - drawWidth) / 2;
    } else {
      drawWidth = size;
      drawHeight = size / sourceRatio;
      y = (size - drawHeight) / 2;
    }
  } else {
    if (sourceRatio > targetRatio) {
      drawWidth = size;
      drawHeight = size / sourceRatio;
      y = (size - drawHeight) / 2;
    } else {
      drawHeight = size;
      drawWidth = size * sourceRatio;
      x = (size - drawWidth) / 2;
    }
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, x, y, drawWidth, drawHeight);
}

function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("No se pudo exportar la imagen."));
    }, mimeType, quality);
  });
}

async function prepareAudioAsset() {
  if (!state.audioFile) return null;
  const outputExtension = dom.audioOutput.value;
  if (!AUDIO_EXTENSIONS.has(outputExtension)) {
    throw new Error("Formato de audio no permitido.");
  }

  const plan = buildAudioPlan();
  if (plan.duration <= 0) {
    throw new Error("El recorte de audio no tiene duración útil.");
  }

  await ensureFFmpeg();

  const inputExtension = extensionOf(state.audioFile.name) || "audio";
  const inputName = `input.${inputExtension}`;
  const outputName = `sound.${outputExtension}`;
  const inputBytes = new Uint8Array(await state.audioFile.arrayBuffer());
  await state.ffmpeg.writeFile(inputName, inputBytes);

  const args = [
    "-hide_banner",
    "-y",
    "-ss",
    secondsArg(plan.inputStart),
    "-t",
    secondsArg(plan.duration),
    "-i",
    inputName,
    "-vn",
    ...audioCodecArgs(outputExtension),
    "-b:a",
    dom.audioBitrate.value
  ];

  const filters = buildAudioFilters(plan, outputExtension);
  if (filters.length) {
    args.push("-af", filters.join(","));
  }
  args.push(outputName);

  setStatus("FFmpeg procesando audio...");
  const exitCode = await state.ffmpeg.exec(args);
  if (exitCode !== 0) {
    throw new Error("FFmpeg no pudo procesar el audio.");
  }

  const output = await state.ffmpeg.readFile(outputName);
  await cleanupFFmpegFiles([inputName, outputName]);

  return {
    name: outputName,
    bytes: output,
    mimeType: audioMimeForExtension(outputExtension)
  };
}

function buildAudioPlan() {
  const duration = stickerDurationSeconds();
  const offset = audioOffsetSeconds();
  const trimStart = clamp(state.trimStart, 0, state.audioDuration || duration);
  const trimEnd = clamp(state.trimEnd || state.audioDuration || duration, trimStart + 0.01, state.audioDuration || duration);
  const positiveOffset = Math.max(0, offset);
  const negativeOffset = Math.max(0, -offset);
  const inputStart = Math.min(trimEnd, trimStart + negativeOffset);
  const available = Math.max(0, trimEnd - inputStart);
  const stickerWindow = Math.max(0, duration - positiveOffset);
  const segmentDuration = Math.min(available, stickerWindow);

  return {
    stickerDuration: duration,
    offset,
    positiveOffset,
    inputStart,
    duration: segmentDuration,
    fadeIn: clamp(Number(dom.fadeIn.value) || 0, 0, segmentDuration / 2),
    fadeOut: clamp(Number(dom.fadeOut.value) || 0, 0, segmentDuration / 2),
    normalize: dom.normalizeAudio.checked
  };
}

function buildAudioFilters(plan) {
  const filters = [];
  if (plan.normalize) {
    filters.push("loudnorm=I=-16:LRA=11:TP=-1.5");
  }
  if (plan.fadeIn > 0) {
    filters.push(`afade=t=in:st=0:d=${secondsArg(plan.fadeIn)}`);
  }
  if (plan.fadeOut > 0) {
    const fadeStart = Math.max(0, plan.duration - plan.fadeOut);
    filters.push(`afade=t=out:st=${secondsArg(fadeStart)}:d=${secondsArg(plan.fadeOut)}`);
  }
  if (plan.positiveOffset > 0) {
    filters.push(`adelay=${Math.round(plan.positiveOffset * 1000)}:all=1`);
  }
  filters.push(`atrim=0:${secondsArg(plan.stickerDuration)}`);
  filters.push("asetpts=PTS-STARTPTS");
  return filters;
}

function audioCodecArgs(extension) {
  if (extension === "mp3") return ["-c:a", "libmp3lame"];
  if (extension === "ogg") return ["-c:a", "libvorbis"];
  return ["-c:a", "aac"];
}

async function ensureFFmpeg() {
  if (state.ffmpegReady) return;
  if (!window.FFmpegWASM?.FFmpeg) {
    throw new Error("No se encontró FFmpeg WASM.");
  }

  const { FFmpeg } = window.FFmpegWASM;
  state.ffmpeg = new FFmpeg();
  state.ffmpeg.on("progress", event => {
    if (Number.isFinite(event.progress)) {
      setProgress(0.28 + Math.min(0.5, Math.max(0, event.progress) * 0.5));
    }
  });
  state.ffmpeg.on("log", event => {
    if (event?.message?.trim()) {
      dom.engineStatus.textContent = "Procesando";
    }
  });

  dom.engineStatus.textContent = "Cargando FFmpeg";
  const baseUrl = new URL(".", window.location.href);
  await state.ffmpeg.load({
    coreURL: new URL("vendor/ffmpeg-core/ffmpeg-core.js", baseUrl).href,
    wasmURL: new URL("vendor/ffmpeg-core/ffmpeg-core.wasm", baseUrl).href
  });
  state.ffmpegReady = true;
  dom.engineStatus.textContent = "FFmpeg listo";
}

async function cleanupFFmpegFiles(paths) {
  await Promise.all(paths.map(path => state.ffmpeg.deleteFile(path).catch(() => null)));
}

function buildManifest(imageAsset, audioAsset) {
  const manifest = {
    version: 1,
    image: imageAsset.name,
    imageMimeType: imageAsset.mimeType,
    durationMs: stickerDurationMs()
  };

  if (audioAsset) {
    manifest.audio = audioAsset.name;
    manifest.audioMimeType = audioAsset.mimeType;
  }
  return manifest;
}

function validateProject() {
  const items = [];
  const packageName = safeBaseName(dom.packageName.value);
  const duration = stickerDurationMs();

  pushValidation(items, Boolean(state.imageFile), "ok", "Imagen lista.", "Falta una imagen compatible.");
  pushValidation(items, packageName.length > 0, "ok", "Nombre de archivo válido.", "El nombre del paquete está vacío.");
  pushValidation(
    items,
    duration >= MIN_DURATION_MS && duration <= MAX_DURATION_MS,
    "ok",
    "Duración dentro del rango.",
    `La duración debe estar entre ${MIN_DURATION_MS} ms y ${MAX_DURATION_MS} ms.`
  );

  if (state.imageFile) {
    const ext = extensionOf(state.imageFile.name);
    pushValidation(items, IMAGE_EXTENSIONS.has(ext), "ok", "Formato visual permitido.", "La imagen debe ser WEBP, PNG o GIF.");
    if ((ext === "gif" || ext === "webp") && dom.imageOutput.value !== "preserve") {
      items.push({ level: "warn", text: "Convertir una animación exporta el frame visible." });
    }
  }

  if (state.audioFile && dom.includeAudio.checked) {
    const ext = extensionOf(state.audioFile.name);
    pushValidation(items, AUDIO_EXTENSIONS.has(ext), "ok", "Formato de audio permitido.", "El audio debe ser M4A, MP3 u OGG.");
    pushValidation(items, state.trimEnd > state.trimStart, "ok", "Recorte de audio válido.", "El final del audio debe ser mayor que el inicio.");
    pushValidation(
      items,
      !requiresHttpRuntime(),
      "ok",
      "FFmpeg disponible para procesar audio.",
      "Abre la herramienta con npm start/http://localhost para exportar stickers con audio."
    );
    if (state.audioDuration && state.audioDuration > stickerDurationSeconds()) {
      items.push({ level: "warn", text: "El audio será recortado a la duración del sticker." });
    }
  }

  if (state.lastPackageSize > 0) {
    const level = state.lastPackageSize <= MAX_PACKAGE_BYTES ? "ok" : "warn";
    items.push({ level, text: `Último paquete: ${formatBytes(state.lastPackageSize)}.` });
  }

  return items;
}

function pushValidation(items, condition, okLevel, okText, errorText) {
  items.push({ level: condition ? okLevel : "error", text: condition ? okText : errorText });
}

function render() {
  if (requiresHttpRuntime()) {
    dom.engineStatus.textContent = "Usa localhost";
    if (!state.audioFile) {
      dom.statusLog.textContent = "Abre esta herramienta con npm start y http://localhost para exportar stickers con audio.";
    }
  }
  const duration = stickerDurationSeconds();
  dom.durationMetric.textContent = `${duration.toFixed(2)}s`;
  dom.audioMetric.textContent = state.audioFile && dom.includeAudio.checked ? `${selectedAudioLength().toFixed(2)}s` : "Sin audio";
  dom.sizeMetric.textContent = state.lastPackageSize ? formatBytes(state.lastPackageSize) : "Pendiente";
  dom.playAudioButton.disabled = !state.audioFile;
  dom.previewSoundButton.disabled = !state.audioFile || !dom.includeAudio.checked;
  dom.fitAudioButton.disabled = !state.audioFile;

  syncTrimControls();
  drawWaveform();
  const isPlaybackActive = dom.playbackTrack?.getAttribute("data-active") === "true";
  if (!isPlaybackActive) {
    if (state.audioFile) {
      const plan = buildAudioPlan();
      updatePlaybackUi(0, plan.duration, false);
    } else {
      updatePlaybackUi(0, 0, false);
    }
  }

  const imageExt = state.imageFile ? extensionOf(state.imageFile.name) : "webp";
  const requestedImage = dom.imageOutput.value === "preserve" ? imageExt : dom.imageOutput.value;
  const audioExt = dom.audioOutput.value;
  const imageName = `sticker.${requestedImage}`;
  const audioName = state.audioFile && dom.includeAudio.checked ? `sound.${audioExt}` : null;
  dom.manifestPreview.textContent = JSON.stringify(
    buildManifest(
      { name: imageName, mimeType: imageMimeForExtension(requestedImage) },
      audioName ? { name: audioName, mimeType: audioMimeForExtension(audioExt) } : null
    ),
    null,
    2
  );

  const validation = validateProject();
  renderValidation(validation);
  dom.exportButton.disabled = state.exporting || validation.some(item => item.level === "error");
  if (dom.addToPackButton) dom.addToPackButton.disabled = dom.exportButton.disabled;
}

function renderValidation(items) {
  dom.validationList.replaceChildren(
    ...items.map(item => {
      const row = document.createElement("div");
      row.className = `validation-item ${item.level}`;
      row.textContent = item.text;
      return row;
    })
  );
}

function drawWaveform() {
  const canvas = dom.waveformCanvas;
  const context = canvas.getContext("2d");
  if (!context) return;

  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#0b1118";
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "rgba(255,255,255,0.08)";
  context.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    const y = (height / 6) * i;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  if (!state.audioBuffer) {
    context.fillStyle = "rgba(154,168,183,0.48)";
    context.font = "700 28px system-ui";
    context.textAlign = "center";
    context.fillText(state.audioFile ? "Audio cargado" : "Sin audio", width / 2, height / 2 + 9);
    return;
  }

  const channel = state.audioBuffer.getChannelData(0);
  const samplesPerPixel = Math.max(1, Math.floor(channel.length / width));
  const center = height / 2;
  context.strokeStyle = "#41d6c3";
  context.lineWidth = 2;
  context.beginPath();
  for (let x = 0; x < width; x++) {
    let min = 1;
    let max = -1;
    const start = x * samplesPerPixel;
    const end = Math.min(channel.length, start + samplesPerPixel);
    for (let i = start; i < end; i++) {
      const sample = channel[i];
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }
    context.moveTo(x, center + min * center * 0.82);
    context.lineTo(x, center + max * center * 0.82);
  }
  context.stroke();

  const total = state.audioDuration || 1;
  const startX = (state.trimStart / total) * width;
  const endX = (state.trimEnd / total) * width;
  context.fillStyle = "rgba(255,123,146,0.18)";
  context.fillRect(0, 0, startX, height);
  context.fillRect(endX, 0, width - endX, height);
  context.strokeStyle = "#ff7b92";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(startX, 0);
  context.lineTo(startX, height);
  context.moveTo(endX, 0);
  context.lineTo(endX, height);
  context.stroke();
}

function resizeWaveform() {
  const rect = dom.waveformCanvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  dom.waveformCanvas.width = Math.max(600, Math.floor(rect.width * ratio));
  dom.waveformCanvas.height = Math.floor(170 * ratio);
  drawWaveform();
}

function resetProject() {
  revokeUrl("imageUrl");
  revokeUrl("audioUrl");
  if (state.audioElement) state.audioElement.pause();
  state.imageFile = null;
  state.imageMeta = null;
  state.audioFile = null;
  state.audioBuffer = null;
  state.audioElement = null;
  state.audioDuration = 0;
  state.trimStart = 0;
  state.trimEnd = 0;
  state.lastPackageSize = 0;
  dom.packageName.value = "netsus_sound_sticker";
  dom.durationMs.value = "900";
  dom.audioOffset.value = "0";
  dom.fadeIn.value = "0.05";
  dom.fadeOut.value = "0.08";
  dom.includeAudio.checked = true;
  dom.normalizeAudio.checked = false;
  dom.imageInput.value = "";
  dom.audioInput.value = "";
  dom.imagePreview.removeAttribute("src");
  dom.imagePreview.style.display = "none";
  dom.emptyPreview.style.display = "grid";
  dom.imageName.textContent = "Arrastra una imagen";
  dom.audioName.textContent = "Audio opcional";
  setStatus("Carga una imagen para comenzar.");
  render();
}

function setStatus(text, level = "ok") {
  dom.statusLog.textContent = text;
  dom.engineStatus.textContent = level === "error" ? "Revisar" : level === "warn" ? "Atención" : "Motor listo";
}

function setProgress(value) {
  dom.progressBar.style.width = `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

function updatePlaybackUi(current, total, isActive = false) {
  if (!dom.playbackBar || !dom.playbackTrack || !dom.playbackCurrent || !dom.playbackTotal) return;
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeCurrent = clamp(Number(current) || 0, 0, safeTotal);
  const progress = safeTotal > 0 ? safeCurrent / safeTotal : 0;
  dom.playbackBar.style.width = `${Math.round(progress * 100)}%`;
  dom.playbackTrack.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
  dom.playbackCurrent.textContent = `${formatSecondsInput(safeCurrent)}s`;
  dom.playbackTotal.textContent = `${formatSecondsInput(safeTotal)}s`;
  if (isActive) {
    dom.playbackTrack.setAttribute("data-active", "true");
  } else {
    dom.playbackTrack.removeAttribute("data-active");
  }
}

function stickerDurationMs() {
  return clamp(Number(dom.durationMs.value) || 900, MIN_DURATION_MS, MAX_DURATION_MS);
}

function stickerDurationSeconds() {
  return stickerDurationMs() / 1000;
}

function audioOffsetSeconds() {
  return clamp(Number(dom.audioOffset.value) || 0, -10, 10);
}

function selectedAudioLength() {
  if (!state.audioFile) return 0;
  const plan = buildAudioPlan();
  return Math.min(plan.stickerDuration, plan.positiveOffset + plan.duration);
}

function secondsArg(value) {
  return String(Math.max(0, value).toFixed(3));
}

function formatSecondsInput(value) {
  return String((Number(value) || 0).toFixed(2));
}

function extensionOf(name) {
  return String(name || "")
    .split("?")[0]
    .split("#")[0]
    .split("/")
    .pop()
    .split("\\")
    .pop()
    .split(".")
    .pop()
    .toLowerCase();
}

function safeBaseName(value) {
  return String(value || "")
    .replace(/\.[^.]+$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function imageMimeForExtension(extension) {
  if (extension === "png") return "image/png";
  if (extension === "gif") return "image/gif";
  return "image/webp";
}

function audioMimeForExtension(extension) {
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "ogg") return "audio/ogg";
  return "audio/mp4";
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function revokeUrl(key) {
  if (state[key]) {
    URL.revokeObjectURL(state[key]);
    state[key] = "";
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function debounce(callback, delay) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), delay);
  };
}
