(() => {
  const canPatch =
    typeof dom !== "undefined" &&
    typeof state !== "undefined" &&
    typeof buildAudioPlan === "function" &&
    typeof setStatus === "function";

  if (!canPatch) return;

  const originalPreviewAudio = typeof previewAudio === "function" ? previewAudio : null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const previewState = {
    audioContext: null,
    source: null,
    gain: null,
    mediaTimer: 0,
    progressRaf: 0,
    previewBuffer: null,
    previewBufferFile: null
  };
  const canUpdatePlayback = typeof updatePlaybackUi === "function";

  replacePreviewHandler(dom.playAudioButton, false);
  replacePreviewHandler(dom.previewSoundButton, true);
  dom.resetButton?.addEventListener("click", stopPreviewPlayback);

  [
    dom.audioInput,
    dom.trimStart,
    dom.trimStartRange,
    dom.trimEnd,
    dom.trimEndRange,
    dom.durationMs,
    dom.audioOffset,
    dom.fadeIn,
    dom.fadeOut,
    dom.includeAudio
  ].forEach(element => {
    element?.addEventListener("input", stopPreviewPlayback);
    element?.addEventListener("change", stopPreviewPlayback);
  });

  syncPlaybackUi();

  function replacePreviewHandler(button, includeStickerTiming) {
    if (!button) return;
    if (originalPreviewAudio) {
      button.removeEventListener("click", originalPreviewAudio);
    }
    button.addEventListener("click", () => previewTrimmedAudio({ includeStickerTiming }));
  }

  function syncPlaybackUi() {
    if (!canUpdatePlayback) return;
    if (!state.audioFile) {
      updatePlaybackUi(0, 0, false);
      return;
    }
    const plan = buildAudioPlan();
    updatePlaybackUi(0, plan.duration, false);
  }

  function startBufferProgress(context, startAt, duration) {
    if (!canUpdatePlayback) return;
    stopProgressTracking();
    updatePlaybackUi(0, duration, true);

    const tick = () => {
      if (!previewState.source) return;
      const elapsed = Math.max(0, context.currentTime - startAt);
      updatePlaybackUi(elapsed, duration, true);
      if (elapsed < duration && previewState.source) {
        previewState.progressRaf = window.requestAnimationFrame(tick);
      }
    };

    previewState.progressRaf = window.requestAnimationFrame(tick);
  }

  function stopProgressTracking() {
    if (previewState.progressRaf) {
      window.cancelAnimationFrame(previewState.progressRaf);
      previewState.progressRaf = 0;
    }
  }

  async function previewTrimmedAudio({ includeStickerTiming }) {
    if (!state.audioFile) return;

    stopPreviewPlayback();

    try {
      const plan = buildAudioPlan();
      if (!plan || plan.duration <= 0) {
        throw new Error("El recorte de audio no tiene duración útil.");
      }

      const context = await ensurePreviewContext();
      const buffer = await getPreviewBuffer(context);
      if (context && buffer) {
        playBufferPreview(context, buffer, plan, includeStickerTiming);
      } else {
        await playMediaPreview(plan);
      }

      setStatus(includeStickerTiming ? "Reproduciendo vista previa con sonido." : "Reproduciendo recorte de audio.");
    } catch (error) {
      console.error(error);
      setStatus("No se pudo reproducir el audio adjunto. Prueba otro formato o vuelve a cargarlo.", "error");
    }
  }

  async function ensurePreviewContext() {
    if (!AudioContextClass) return null;
    if (!previewState.audioContext || previewState.audioContext.state === "closed") {
      previewState.audioContext = new AudioContextClass();
    }
    if (previewState.audioContext.state === "suspended") {
      await previewState.audioContext.resume();
    }
    return previewState.audioContext;
  }

  async function getPreviewBuffer(context) {
    if (state.audioBuffer) {
      previewState.previewBuffer = state.audioBuffer;
      previewState.previewBufferFile = state.audioFile;
      return state.audioBuffer;
    }

    if (previewState.previewBuffer && previewState.previewBufferFile === state.audioFile) {
      return previewState.previewBuffer;
    }

    if (!context || !state.audioFile) return null;

    try {
      const bytes = await state.audioFile.arrayBuffer();
      const decoded = await context.decodeAudioData(bytes.slice(0));
      previewState.previewBuffer = decoded;
      previewState.previewBufferFile = state.audioFile;
      state.audioBuffer = decoded;
      state.audioDuration = decoded.duration;
      return decoded;
    } catch (error) {
      console.warn("No se pudo decodificar el audio para Web Audio; se usará HTMLAudioElement.", error);
      return null;
    }
  }

  function playBufferPreview(context, buffer, plan, includeStickerTiming) {
    const inputStart = Math.max(0, Math.min(plan.inputStart, Math.max(0, buffer.duration - 0.01)));
    const available = Math.max(0, buffer.duration - inputStart);
    const duration = Math.max(0.01, Math.min(plan.duration, available));
    const startDelay = includeStickerTiming ? Math.max(0, plan.positiveOffset || 0) : 0;
    const source = context.createBufferSource();
    const gain = context.createGain();
    const now = context.currentTime;
    const startAt = now + startDelay;
    const fadeIn = Math.max(0, Math.min(plan.fadeIn || 0, duration / 2));
    const fadeOut = Math.max(0, Math.min(plan.fadeOut || 0, duration / 2));

    source.buffer = buffer;
    source.connect(gain);
    gain.connect(context.destination);

    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(startDelay > 0 || fadeIn > 0 ? 0 : 1, now);
    gain.gain.setValueAtTime(fadeIn > 0 ? 0 : 1, startAt);

    if (fadeIn > 0) {
      gain.gain.linearRampToValueAtTime(1, startAt + fadeIn);
    }
    if (fadeOut > 0) {
      const fadeOutStart = startAt + Math.max(0, duration - fadeOut);
      gain.gain.setValueAtTime(1, fadeOutStart);
      gain.gain.linearRampToValueAtTime(0, startAt + duration);
    }

    source.onended = () => {
      if (previewState.source === source) {
        stopPreviewPlayback();
      }
    };

    previewState.source = source;
    previewState.gain = gain;
    source.start(startAt, inputStart, duration);
    startBufferProgress(context, startAt, duration);
  }

  async function playMediaPreview(plan) {
    const media = state.audioElement;
    if (!media) throw new Error("No audio element loaded");

    if (typeof ensureAudioElementReady === "function") {
      await ensureAudioElementReady();
    } else if (media.readyState < HTMLMediaElement.HAVE_METADATA) {
      await new Promise((resolve, reject) => {
        media.addEventListener("loadedmetadata", resolve, { once: true });
        media.addEventListener("error", reject, { once: true });
        media.load();
      });
    }

    const inputStart = Math.max(0, plan.inputStart);
    const stopAt = inputStart + Math.max(0.05, plan.duration);
    media.pause();
    media.currentTime = inputStart;
    media.volume = 1;
    await media.play();

    if (canUpdatePlayback) {
      updatePlaybackUi(0, plan.duration, true);
    }

    previewState.mediaTimer = window.setInterval(() => {
      const activeMedia = state.audioElement;
      if (!activeMedia) {
        stopPreviewPlayback();
        return;
      }
      const elapsed = Math.max(0, activeMedia.currentTime - inputStart);
      if (canUpdatePlayback) {
        updatePlaybackUi(elapsed, plan.duration, true);
      }
      if (activeMedia.paused || activeMedia.currentTime >= stopAt) {
        stopPreviewPlayback();
      }
    }, 30);
  }

  function stopPreviewPlayback() {
    if (previewState.mediaTimer) {
      window.clearInterval(previewState.mediaTimer);
      previewState.mediaTimer = 0;
    }

    stopProgressTracking();

    if (state.audioElement) {
      state.audioElement.pause();
    }

    if (previewState.source) {
      const source = previewState.source;
      previewState.source = null;
      source.onended = null;
      try {
        source.stop(0);
      } catch (_) {
        // The source may already be stopped.
      }
    }

    cleanupBufferPreview();
    syncPlaybackUi();
  }

  function cleanupBufferPreview() {
    if (previewState.gain) {
      try {
        previewState.gain.disconnect();
      } catch (_) {
        // Already disconnected.
      }
    }
    previewState.gain = null;
    previewState.source = null;
  }
})();
