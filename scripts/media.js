let currentObjectUrl = null;
let defaultMediaConfig = null;
let lastRenderedMediaKey = null;

function getMediaKind(media) {
  if (!media || !media.src) return "image";

  if (media.type) return media.type;

  const src = media.src.toLowerCase();

  if (src.endsWith(".mp4") || src.endsWith(".webm")) return "video";
  if (src.endsWith(".gif")) return "gif";

  return "image";
}

function getMediaRenderKey(media) {
  if (!media) {
    return "null";
  }

  return JSON.stringify({
    type: media.type || "",
    src: media.src || "",
    poster: media.poster || "",
    alt: media.alt || ""
  });
}

function getMediaKindFromFile(file) {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();

  if (type.startsWith("video/") || name.endsWith(".mp4") || name.endsWith(".webm")) {
    return "video";
  }

  if (type === "image/gif" || name.endsWith(".gif")) {
    return "gif";
  }

  return "image";
}

function cleanupObjectUrl() {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

function setToggleButtonState(hasVideo, paused = false) {
  const toggleBtn = document.getElementById("togglePortraitMotionBtn");
  if (!toggleBtn) return;

  toggleBtn.disabled = !hasVideo;
  toggleBtn.textContent = hasVideo ? (paused ? "▶" : "❚❚") : "•";
  toggleBtn.setAttribute(
    "aria-label",
    hasVideo
      ? paused
        ? "Запустить анимацию"
        : "Пауза анимации"
      : "Видео недоступно"
  );
}

function renderPortraitMarkup(media) {
  const portraitStage = document.getElementById("portraitStage");
  if (!portraitStage) return;

  const nextMediaKey = getMediaRenderKey(media);
  if (nextMediaKey === lastRenderedMediaKey) {
    return;
  }

  lastRenderedMediaKey = nextMediaKey;

  const toggleBtn = document.getElementById("togglePortraitMotionBtn");
  const mediaKind = getMediaKind(media);

  let mediaMarkup = "";
  let hasVideo = false;

  if (!media || !media.src) {
    mediaMarkup = `
      <img
        class="portrait-poster"
        src="./assets/portrait.png"
        alt="Портрет персонажа"
      />
    `;
  } else if (mediaKind === "video") {
    const mimeType =
      media.src.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4";

    mediaMarkup = `
      <video
        class="portrait-media"
        id="portraitVideo"
        autoplay
        muted
        loop
        playsinline
        preload="metadata"
        poster="${media.poster || ""}"
        aria-label="${media.alt || "Анимированный портрет персонажа"}"
      >
        <source src="${media.src}" type="${mimeType}" />
      </video>
    `;
    hasVideo = true;
  } else {
    mediaMarkup = `
      <img
        class="portrait-media"
        src="${media.src}"
        alt="${media.alt || "Портрет персонажа"}"
      />
    `;
  }

  portraitStage.innerHTML = `
    ${mediaMarkup}
  `;

  if (toggleBtn) {
    portraitStage.appendChild(toggleBtn);
  }

  if (hasVideo) {
    const video = document.getElementById("portraitVideo");
    if (video) {
      video.muted = true;
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          console.warn("Автовоспроизведение портрета было заблокировано браузером");
        });
      }
    }
  }

  setToggleButtonState(hasVideo, false);
}

export function renderPortraitMedia(state) {
  defaultMediaConfig = structuredClone(state.profile.media || null);
  renderPortraitMarkup(defaultMediaConfig);
}

export function initPortraitControls() {
  const toggleBtn = document.getElementById("togglePortraitMotionBtn");
  const fileInput = document.getElementById("portraitFileInput");
  const resetBtn = document.getElementById("resetPortraitBtn");

  if (toggleBtn && !toggleBtn.dataset.bound) {
    toggleBtn.addEventListener("click", () => {
      const video = document.getElementById("portraitVideo");
      if (!video) return;

      if (video.paused) {
        video.play();
        setToggleButtonState(true, false);
      } else {
        video.pause();
        setToggleButtonState(true, true);
      }
    });

    toggleBtn.dataset.bound = "true";
  }

  if (fileInput && !fileInput.dataset.bound) {
    fileInput.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (!file) return;

      cleanupObjectUrl();
      currentObjectUrl = URL.createObjectURL(file);

      lastRenderedMediaKey = null;
      renderPortraitMarkup(defaultMediaConfig);

      const mediaKind = getMediaKindFromFile(file);

      const localMedia = {
        type: mediaKind,
        src: currentObjectUrl,
        poster: mediaKind === "video" ? (defaultMediaConfig?.poster || "./assets/portrait.png") : "",
        alt: `Локальный файл: ${file.name}`
      };

      renderPortraitMarkup(localMedia);
    });

    fileInput.dataset.bound = "true";
  }

  if (resetBtn && !resetBtn.dataset.bound) {
    resetBtn.addEventListener("click", () => {
      cleanupObjectUrl();
      lastRenderedMediaKey = null;
      renderPortraitMarkup(defaultMediaConfig);
      if (fileInput) {
        fileInput.value = "";
      }
      renderPortraitMarkup(defaultMediaConfig);
    });

    resetBtn.dataset.bound = "true";
  }
}