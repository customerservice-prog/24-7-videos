(() => {
  const video = document.getElementById("liveVideo");
  const shell = document.getElementById("channelShell");
  const offlineState = document.getElementById("offlineState");
  const nowCard = document.getElementById("nowCard");
  const nowTitle = document.getElementById("nowTitle");
  const nextTitle = document.getElementById("nextTitle");
  const channelName = document.getElementById("channelName");
  const channelTagline = document.getElementById("channelTagline");
  const soundButton = document.getElementById("soundButton");
  const soundIcon = document.getElementById("soundIcon");
  const fullscreenButton = document.getElementById("fullscreenButton");
  const connectionBadge = document.getElementById("connectionBadge");
  const entryGate = document.getElementById("entryGate");
  const enterButton = document.getElementById("enterButton");

  let state = null;
  let serverOffsetMs = 0;
  let switching = false;
  let retryTimer = null;
  let lastPlaylistVersion = null;
  let hasEntered = false;

  video.controls = false;
  video.muted = true;
  video.defaultMuted = true;
  video.playbackRate = 1;

  function livePosition() {
    const videos = state?.videos || [];
    const cycle = Number(state?.cycleDuration || 0);
    if (!videos.length || cycle <= 0) return null;

    const serverNow = Date.now() + serverOffsetMs;
    const elapsed = Math.max(0, (serverNow - Number(state.channel.scheduleEpoch)) / 1000);
    let remaining = elapsed % cycle;

    for (let index = 0; index < videos.length; index += 1) {
      const item = videos[index];
      const duration = Number(item.duration);
      if (remaining < duration || index === videos.length - 1) {
        return {
          item,
          index,
          offset: Math.min(Math.max(remaining, 0), Math.max(0, duration - 0.08)),
          next: videos[(index + 1) % videos.length]
        };
      }
      remaining -= duration;
    }
    return null;
  }

  function setOffline(isOffline) {
    offlineState.hidden = !isOffline;
    nowCard.hidden = isOffline;
    if (isOffline && video.getAttribute("src")) {
      video.removeAttribute("src");
      video.removeAttribute("data-video-id");
      video.load();
    }
  }

  async function safePlay() {
    try {
      await video.play();
    } catch {
      if (!hasEntered) {
        video.muted = true;
        soundIcon.textContent = "Sound on";
      }
      try { await video.play(); } catch {}
    }
  }

  function syncPlayback(force = false) {
    const live = livePosition();
    if (!live) {
      setOffline(true);
      return;
    }

    setOffline(false);
    nowTitle.textContent = live.item.title;
    nextTitle.textContent = live.next ? "Up next · " + live.next.title : "Continuous live programming";

    if (video.dataset.videoId !== live.item.id) {
      switching = true;
      video.dataset.videoId = live.item.id;
      video.src = live.item.url;
      video.load();

      const onReady = async () => {
        const fresh = livePosition();
        if (!fresh || fresh.item.id !== video.dataset.videoId) {
          switching = false;
          syncPlayback(true);
          return;
        }

        try {
          if (Number.isFinite(video.duration) && video.duration > 0) {
            video.currentTime = Math.min(fresh.offset, Math.max(0, video.duration - 0.08));
          } else {
            video.currentTime = fresh.offset;
          }
        } catch {}

        video.playbackRate = 1;
        switching = false;
        await safePlay();
      };

      video.addEventListener("loadedmetadata", onReady, { once: true });
      return;
    }

    const drift = Math.abs(Number(video.currentTime || 0) - live.offset);
    if (force || drift > 1.5) {
      try { video.currentTime = live.offset; } catch {}
    }

    if (video.playbackRate !== 1) video.playbackRate = 1;
    if (video.paused && !switching) safePlay();
  }

  async function refreshState() {
    try {
      const response = await fetch("/api/channel/state", { cache: "no-store" });
      if (!response.ok) throw new Error("Channel unavailable");
      const nextState = await response.json();

      serverOffsetMs = Number(nextState.serverTime) - Date.now();
      state = nextState;
      channelName.textContent = state.channel?.name || "24/7 LIVE";
      channelTagline.textContent = state.channel?.tagline || "";
      document.title = (state.channel?.name || "24/7 Live") + " · Live";

      const changed = lastPlaylistVersion !== state.playlistVersion;
      lastPlaylistVersion = state.playlistVersion;
      connectionBadge.hidden = true;
      syncPlayback(changed);
    } catch {
      connectionBadge.hidden = false;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(refreshState, 3000);
    }
  }

  enterButton.addEventListener("click", async () => {
    hasEntered = true;
    entryGate.hidden = true;
    video.muted = false;
    soundIcon.textContent = "Mute";
    syncPlayback(true);
    await safePlay();

    try {
      if (!document.fullscreenElement) await shell.requestFullscreen();
    } catch {}
  });

  soundButton.addEventListener("click", async () => {
    video.muted = !video.muted;
    soundIcon.textContent = video.muted ? "Sound on" : "Mute";
    await safePlay();
  });

  fullscreenButton.addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) await shell.requestFullscreen();
      else await document.exitFullscreen();
    } catch {}
  });

  video.addEventListener("pause", () => {
    if (!switching && state?.videos?.length) {
      setTimeout(() => {
        syncPlayback(true);
        safePlay();
      }, 0);
    }
  });

  video.addEventListener("ratechange", () => {
    if (video.playbackRate !== 1) video.playbackRate = 1;
  });

  video.addEventListener("seeking", () => {
    if (switching) return;
    const live = livePosition();
    if (!live || live.item.id !== video.dataset.videoId) return;
    if (Math.abs(video.currentTime - live.offset) > 2) {
      try { video.currentTime = live.offset; } catch {}
    }
  });

  video.addEventListener("ended", () => syncPlayback(true));
  video.addEventListener("error", () => {
    connectionBadge.hidden = false;
    switching = false;
    video.removeAttribute("data-video-id");
    setTimeout(() => syncPlayback(true), 1800);
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refreshState();
      syncPlayback(true);
    }
  });

  window.addEventListener("pageshow", () => syncPlayback(true));
  window.addEventListener("online", refreshState);
  video.addEventListener("contextmenu", (event) => event.preventDefault());

  refreshState();
  setInterval(() => syncPlayback(false), 1000);
  setInterval(refreshState, 30000);
})();
