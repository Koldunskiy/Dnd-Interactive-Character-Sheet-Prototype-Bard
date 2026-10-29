import { getSessionContext, isCurrentSession } from "./state.js";

const localOverrides = new Map();
let activeCharacterId = null;
let activeDefaultMedia = null;
let lastRenderedMediaKey = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function getMediaKind(media) {
  if (!media?.src) return "placeholder";
  if (media.type) return media.type;
  const source = String(media.src).toLowerCase();
  return source.endsWith(".mp4") || source.endsWith(".webm") ? "video" :
    source.endsWith(".gif") ? "gif" : "image";
}

function mediaKey(characterId, media) {
  return `${characterId}:${JSON.stringify(media ?? null)}`;
}

function setToggleButtonState(hasVideo, paused = false, characterId = activeCharacterId) {
  if (characterId !== activeCharacterId) return;
  const button = document.getElementById("togglePortraitMotionBtn");
  if (!button) return;
  let icon = button.querySelector(".portrait-toggle-btn__icon");
  if (!icon) {
    icon = document.createElement("span");
    icon.className = "portrait-toggle-btn__icon";
    button.replaceChildren(icon);
  }
  button.disabled = !hasVideo;
  button.classList.toggle("is-paused", hasVideo && paused);
  button.classList.toggle("is-disabled", !hasVideo);
  button.setAttribute("aria-pressed", hasVideo ? String(paused) : "false");
  icon.textContent = hasVideo && !paused ? "❚❚" : "▶";
  button.setAttribute("aria-label", hasVideo ? (paused ? "Запустить анимацию" : "Пауза анимации") : "Анимация недоступна");
}

function renderPortraitMarkup(media, characterId) {
  const stage = document.getElementById("portraitStage");
  if (!stage) return;
  const renderKey = mediaKey(characterId, media);
  if (renderKey === lastRenderedMediaKey) return;
  lastRenderedMediaKey = renderKey;
  const toggleButton = document.getElementById("togglePortraitMotionBtn");
  const kind = getMediaKind(media);

  if (kind === "placeholder") {
    stage.replaceChildren();
    const placeholder = document.createElement("div");
    placeholder.className = "portrait-placeholder";
    placeholder.setAttribute("role", "img");
    placeholder.setAttribute("aria-label", "Портрет не задан");
    placeholder.textContent = "Портрет не задан";
    stage.append(placeholder);
    if (toggleButton) stage.append(toggleButton);
    setToggleButtonState(false, true, characterId);
    return;
  }

  if (kind === "video") {
    const video = document.createElement("video");
    video.className = "portrait-media portrait-media--video";
    video.id = "portraitVideo";
    video.autoplay = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.poster = String(media.poster ?? "");
    video.setAttribute("aria-label", String(media.alt || "Анимированный портрет персонажа"));
    const source = document.createElement("source");
    source.src = String(media.src);
    source.type = String(media.src).toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4";
    video.append(source);
    const context = getSessionContext();
    const sync = () => {
      if (isCurrentSession(context) && video.isConnected && document.getElementById("portraitVideo") === video) {
        setToggleButtonState(true, video.paused, context.characterId);
      }
    };
    video.addEventListener("play", sync);
    video.addEventListener("pause", sync);
    video.addEventListener("ended", sync);
    stage.replaceChildren(video);
    if (toggleButton) stage.append(toggleButton);
    const playPromise = video.play();
    if (playPromise?.catch) {
      playPromise.catch(() => {
        if (isCurrentSession(context) && video.isConnected) setToggleButtonState(true, true, context.characterId);
      });
    }
    return;
  }

  const image = document.createElement("img");
  image.className = "portrait-media";
  image.src = String(media.src);
  image.alt = String(media.alt || "Портрет персонажа");
  stage.replaceChildren(image);
  if (toggleButton) stage.append(toggleButton);
  setToggleButtonState(false, true, characterId);
}

function releaseOverride(characterId) {
  const media = localOverrides.get(characterId);
  if (media?.objectUrl) URL.revokeObjectURL(media.objectUrl);
  localOverrides.delete(characterId);
}

export function renderPortraitMedia(state) {
  activeCharacterId = String(state.profile?.id ?? "aurelia");
  activeDefaultMedia = structuredClone(state.profile?.media ?? null);
  const displayed = localOverrides.get(activeCharacterId)?.media ?? activeDefaultMedia;
  renderPortraitMarkup(displayed, activeCharacterId);
}

export function resetPortraitForCharacter(characterId) {
  releaseOverride(characterId);
  if (activeCharacterId === characterId) lastRenderedMediaKey = null;
}

export function initPortraitControls() {
  const toggle = document.getElementById("togglePortraitMotionBtn");
  const input = document.getElementById("portraitFileInput");
  const reset = document.getElementById("resetPortraitBtn");

  if (toggle && !toggle.dataset.bound) {
    toggle.addEventListener("click", () => {
      const context = getSessionContext();
      const video = document.getElementById("portraitVideo");
      if (!video || !video.isConnected || context.characterId !== activeCharacterId) return;
      if (video.paused) {
        video.play()?.catch(() => {
          if (isCurrentSession(context) && video.isConnected) setToggleButtonState(true, true, context.characterId);
        });
      } else {
        video.pause();
      }
    });
    toggle.dataset.bound = "true";
  }
  if (input && !input.dataset.bound) {
    input.addEventListener("change", (event) => {
      const context = getSessionContext();
      if (!isCurrentSession(context)) return;
      const file = event.currentTarget.files?.[0];
      if (!file) return;
      releaseOverride(context.characterId);
      const objectUrl = URL.createObjectURL(file);
      const name = file.name.toLowerCase();
      const type = file.type.toLowerCase();
      const kind = type.startsWith("video/") || name.endsWith(".mp4") || name.endsWith(".webm")
        ? "video" : type === "image/gif" || name.endsWith(".gif") ? "gif" : "image";
      const media = { type: kind, src: objectUrl, objectUrl, poster: kind === "video" ? activeDefaultMedia?.poster ?? "" : "", alt: `Локальный файл: ${file.name}` };
      localOverrides.set(context.characterId, { media, objectUrl });
      lastRenderedMediaKey = null;
      renderPortraitMarkup(media, context.characterId);
    });
    input.dataset.bound = "true";
  }
  if (reset && !reset.dataset.bound) {
    reset.addEventListener("click", () => {
      const context = getSessionContext();
      if (!isCurrentSession(context)) return;
      releaseOverride(context.characterId);
      lastRenderedMediaKey = null;
      if (input) input.value = "";
      renderPortraitMarkup(activeDefaultMedia, context.characterId);
    });
    reset.dataset.bound = "true";
  }
}

window.addEventListener("pagehide", () => {
  for (const characterId of localOverrides.keys()) releaseOverride(characterId);
});
