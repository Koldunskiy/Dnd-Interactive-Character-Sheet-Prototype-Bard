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

  let icon = toggleBtn.querySelector(".portrait-toggle-btn__icon");
  if (!icon) {
    icon = document.createElement("span");
    icon.className = "portrait-toggle-btn__icon";
    toggleBtn.innerHTML = "";
    toggleBtn.appendChild(icon);
  }

  toggleBtn.disabled = !hasVideo;
  toggleBtn.classList.toggle("is-paused", hasVideo && paused);
  toggleBtn.classList.toggle("is-disabled", !hasVideo);
  toggleBtn.setAttribute("aria-pressed", hasVideo ? String(paused) : "false");

  if (!hasVideo) {
    icon.textContent = "▶";
    toggleBtn.setAttribute("aria-label", "Анимация недоступна");
    toggleBtn.setAttribute("title", "Анимация недоступна");
    return;
  }

  icon.textContent = paused ? "▶" : "❚❚";
  toggleBtn.setAttribute(
    "aria-label",
    paused ? "Запустить анимацию" : "Пауза анимации"
  );
  toggleBtn.setAttribute(
    "title",
    paused ? "Воспроизвести" : "Пауза"
  );
}

function bindPortraitVideoState(video) {
  if (!video || video.dataset.stateBound === "true") {
    return;
  }

  const sync = () => {
    setToggleButtonState(true, video.paused);
  };

  video.addEventListener("play", sync);
  video.addEventListener("pause", sync);
  video.addEventListener("ended", sync);

  video.dataset.stateBound = "true";
  sync();
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
        class="portrait-media portrait-media--video"
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

  portraitStage.innerHTML = mediaMarkup;

  if (toggleBtn) {
    portraitStage.appendChild(toggleBtn);
  }

  if (hasVideo) {
    const video = document.getElementById("portraitVideo");
    if (video) {
      video.muted = true;
      bindPortraitVideoState(video);

      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          console.warn("Автовоспроизведение портрета было заблокировано браузером");
          setToggleButtonState(true, true);
        });
      }
    } else {
      setToggleButtonState(true, true);
    }
  } else {
    setToggleButtonState(false, true);
  }
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
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch(() => {
            setToggleButtonState(true, true);
          });
        }
      } else {
        video.pause();
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

      const mediaKind = getMediaKindFromFile(file);

      const localMedia = {
        type: mediaKind,
        src: currentObjectUrl,
        poster:
          mediaKind === "video"
            ? (defaultMediaConfig?.poster || "./assets/portrait.png")
            : "",
        alt: `Локальный файл: ${file.name}`
      };

      lastRenderedMediaKey = null;
      renderPortraitMarkup(localMedia);
    });

    fileInput.dataset.bound = "true";
  }

  if (resetBtn && !resetBtn.dataset.bound) {
    resetBtn.addEventListener("click", () => {
      cleanupObjectUrl();
      lastRenderedMediaKey = null;

      if (fileInput) {
        fileInput.value = "";
      }

      renderPortraitMarkup(defaultMediaConfig);
    });

    resetBtn.dataset.bound = "true";
  }
}