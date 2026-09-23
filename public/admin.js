(() => {
  const loginShell = document.getElementById("loginShell");
  const loginForm = document.getElementById("loginForm");
  const passwordInput = document.getElementById("passwordInput");
  const loginMessage = document.getElementById("loginMessage");
  const dashboard = document.getElementById("dashboard");
  const logoutButton = document.getElementById("logoutButton");
  const restartButton = document.getElementById("restartButton");
  const fileInput = document.getElementById("fileInput");
  const chooseButton = document.getElementById("chooseButton");
  const dropzone = document.getElementById("dropzone");
  const uploadList = document.getElementById("uploadList");
  const programList = document.getElementById("programList");
  const settingsForm = document.getElementById("settingsForm");
  const channelNameInput = document.getElementById("channelNameInput");
  const channelTaglineInput = document.getElementById("channelTaglineInput");
  const settingsMessage = document.getElementById("settingsMessage");
  const previewVideo = document.getElementById("previewVideo");
  const previewEmpty = document.getElementById("previewEmpty");
  const previewTitle = document.getElementById("previewTitle");
  const nextUpNote = document.getElementById("nextUpNote");
  const statNow = document.getElementById("statNow");
  const statCount = document.getElementById("statCount");
  const statCycle = document.getElementById("statCycle");
  const statStorage = document.getElementById("statStorage");

  let data = null;
  let previewVideoId = null;
  let serverOffsetMs = 0;

  function formatDuration(seconds) {
    seconds = Math.max(0, Math.round(Number(seconds || 0)));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours) return hours + "h " + minutes + "m";
    if (minutes) return minutes + "m " + secs + "s";
    return secs + "s";
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
    if (value < 1024 * 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + " MB";
    return (value / 1024 / 1024 / 1024).toFixed(2) + " GB";
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      cache: "no-store",
      ...options,
      headers: {
        ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });

    if (response.status === 401) {
      showLogin();
      throw new Error("Session expired");
    }

    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Request failed");
    return body;
  }

  function showLogin() {
    dashboard.hidden = true;
    loginShell.hidden = false;
    passwordInput.focus();
  }

  function showDashboard() {
    loginShell.hidden = true;
    dashboard.hidden = false;
  }

  async function checkSession() {
    try {
      const session = await api("/api/admin/session");
      if (!session.configured) {
        loginMessage.textContent = "Admin is not configured yet. Set ADMIN_PASSWORD (8+ characters) on the server, then reload.";
        passwordInput.disabled = true;
        return;
      }
      if (session.authenticated) {
        showDashboard();
        await loadDashboard();
      } else {
        showLogin();
      }
    } catch (error) {
      loginMessage.textContent = error.message;
    }
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginMessage.textContent = "";
    try {
      await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password: passwordInput.value })
      });
      passwordInput.value = "";
      showDashboard();
      await loadDashboard();
    } catch (error) {
      loginMessage.textContent = error.message;
    }
  });

  logoutButton.addEventListener("click", async () => {
    await api("/api/admin/logout", { method: "POST" }).catch(() => {});
    showLogin();
  });

  async function loadDashboard() {
    data = await api("/api/admin/dashboard");
    serverOffsetMs = Number(data.serverTime || Date.now()) - Date.now();
    render();
  }

  function render() {
    if (!data) return;
    statCount.textContent = String(data.stats.activeVideos);
    statCycle.textContent = formatDuration(data.stats.cycleDuration);
    statStorage.textContent = formatBytes(data.stats.storageBytes);
    statNow.textContent = data.nowPlaying?.title || "Standby";

    channelNameInput.value = data.channel.name || "";
    channelTaglineInput.value = data.channel.tagline || "";

    renderPrograms();
    syncPreview(true);
  }

  function createButton(label, title, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-button " + className;
    button.textContent = label;
    button.title = title;
    return button;
  }

  function renderPrograms() {
    programList.innerHTML = "";
    if (!data.videos.length) {
      const empty = document.createElement("div");
      empty.className = "small-note";
      empty.style.padding = "12px 2px 2px";
      empty.textContent = "No videos yet. Your first upload becomes program #1.";
      programList.appendChild(empty);
      return;
    }

    data.videos.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "program-row" + (item.enabled ? "" : " disabled");
      row.dataset.id = item.id;

      const order = document.createElement("div");
      order.className = "order-number";
      order.textContent = String(index + 1);

      const editor = document.createElement("div");
      editor.className = "title-editor";
      const input = document.createElement("input");
      input.value = item.title;
      input.maxLength = 120;
      input.setAttribute("aria-label", "Video title");
      input.addEventListener("change", async () => {
        const title = input.value.trim();
        if (!title || title === item.title) return;
        try {
          await api("/api/admin/videos/" + encodeURIComponent(item.id), {
            method: "PATCH",
            body: JSON.stringify({ title })
          });
          item.title = title;
          await loadDashboard();
        } catch (error) {
          alert(error.message);
          input.value = item.title;
        }
      });
      editor.appendChild(input);

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = formatDuration(item.duration) + " · " + formatBytes(item.size);

      const toggleLabel = document.createElement("label");
      toggleLabel.className = "status-toggle";
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = item.enabled;
      toggle.addEventListener("change", async () => {
        try {
          await api("/api/admin/videos/" + encodeURIComponent(item.id), {
            method: "PATCH",
            body: JSON.stringify({ enabled: toggle.checked })
          });
          await loadDashboard();
        } catch (error) {
          alert(error.message);
          toggle.checked = !toggle.checked;
        }
      });
      toggleLabel.append(toggle, document.createTextNode(item.enabled ? "On air" : "Disabled"));

      const actions = document.createElement("div");
      actions.className = "row-actions";

      const up = createButton("↑", "Move earlier");
      up.disabled = index === 0;
      up.addEventListener("click", () => moveVideo(index, -1));

      const down = createButton("↓", "Move later");
      down.disabled = index === data.videos.length - 1;
      down.addEventListener("click", () => moveVideo(index, 1));

      const remove = createButton("×", "Delete video", "delete");
      remove.addEventListener("click", async () => {
        if (!confirm('Delete "' + item.title + '" from the channel?')) return;
        try {
          await api("/api/admin/videos/" + encodeURIComponent(item.id), { method: "DELETE" });
          await loadDashboard();
        } catch (error) {
          alert(error.message);
        }
      });

      actions.append(up, down, remove);
      row.append(order, editor, meta, toggleLabel, actions);
      programList.appendChild(row);
    });
  }

  async function moveVideo(index, delta) {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= data.videos.length) return;
    const ids = data.videos.map((video) => video.id);
    [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];

    try {
      await api("/api/admin/reorder", {
        method: "POST",
        body: JSON.stringify({ ids })
      });
      await loadDashboard();
    } catch (error) {
      alert(error.message);
    }
  }

  function livePreviewPosition() {
    const active = data?.videos?.filter((item) => item.enabled) || [];
    const cycle = active.reduce((sum, item) => sum + Number(item.duration), 0);
    if (!active.length || cycle <= 0) return null;

    const serverNow = Date.now() + serverOffsetMs;
    let remaining = Math.max(0, (serverNow - Number(data.channel.scheduleEpoch)) / 1000) % cycle;

    for (let index = 0; index < active.length; index += 1) {
      const item = active[index];
      if (remaining < Number(item.duration) || index === active.length - 1) {
        return { item, offset: remaining, next: active[(index + 1) % active.length] };
      }
      remaining -= Number(item.duration);
    }
    return null;
  }

  async function syncPreview(force = false) {
    if (!data) return;
    const live = livePreviewPosition();

    if (!live) {
      previewVideoId = null;
      previewVideo.removeAttribute("src");
      previewVideo.load();
      previewEmpty.hidden = false;
      previewTitle.textContent = "Channel standby";
      nextUpNote.textContent = "Nothing queued yet.";
      return;
    }

    previewEmpty.hidden = true;
    previewTitle.textContent = live.item.title;
    nextUpNote.textContent = "Up next: " + live.next.title;
    statNow.textContent = live.item.title;

    if (previewVideoId !== live.item.id) {
      previewVideoId = live.item.id;
      previewVideo.src = live.item.url;
      previewVideo.load();
      previewVideo.addEventListener("loadedmetadata", () => {
        try { previewVideo.currentTime = livePreviewPosition()?.offset || 0; } catch {}
        previewVideo.play().catch(() => {});
      }, { once: true });
      return;
    }

    if (force || Math.abs(previewVideo.currentTime - live.offset) > 2) {
      try { previewVideo.currentTime = live.offset; } catch {}
    }
    if (previewVideo.paused) previewVideo.play().catch(() => {});
  }

  restartButton.addEventListener("click", async () => {
    if (!confirm("Restart the live channel from program #1 now? Every viewer will jump to the beginning of the rotation.")) return;
    try {
      await api("/api/admin/restart", { method: "POST" });
      await loadDashboard();
    } catch (error) {
      alert(error.message);
    }
  });

  settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    settingsMessage.textContent = "Saving…";
    try {
      await api("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({
          name: channelNameInput.value,
          tagline: channelTaglineInput.value
        })
      });
      settingsMessage.textContent = "Saved.";
      await loadDashboard();
    } catch (error) {
      settingsMessage.textContent = error.message;
    }
  });

  function readDuration(file) {
    return new Promise((resolve, reject) => {
      const temp = document.createElement("video");
      const url = URL.createObjectURL(file);
      temp.preload = "metadata";
      temp.muted = true;
      temp.onloadedmetadata = () => {
        const duration = Number(temp.duration);
        URL.revokeObjectURL(url);
        if (Number.isFinite(duration) && duration > 0) resolve(duration);
        else reject(new Error("Could not read video duration"));
      };
      temp.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Browser cannot read this video file"));
      };
      temp.src = url;
    });
  }

  function uploadFile(file, duration) {
    return new Promise((resolve, reject) => {
      const row = document.createElement("div");
      row.className = "upload-row";
      row.innerHTML = '<div class="upload-top"><strong></strong><span>0%</span></div><div class="progress"><span></span></div>';
      row.querySelector("strong").textContent = file.name;
      const percent = row.querySelector(".upload-top span");
      const bar = row.querySelector(".progress span");
      uploadList.appendChild(row);

      const form = new FormData();
      form.append("video", file);
      form.append("duration", String(duration));
      form.append("title", file.name.replace(/\.[^.]+$/, ""));

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/admin/videos");
      xhr.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable) return;
        const value = Math.round((event.loaded / event.total) * 100);
        percent.textContent = value + "%";
        bar.style.width = value + "%";
      });
      xhr.addEventListener("load", () => {
        let body = {};
        try { body = JSON.parse(xhr.responseText || "{}"); } catch {}
        if (xhr.status >= 200 && xhr.status < 300) {
          percent.textContent = "Done";
          bar.style.width = "100%";
          setTimeout(() => row.remove(), 1000);
          resolve(body);
        } else {
          percent.textContent = "Failed";
          reject(new Error(body.error || "Upload failed"));
        }
      });
      xhr.addEventListener("error", () => {
        percent.textContent = "Failed";
        reject(new Error("Upload connection failed"));
      });
      xhr.send(form);
    });
  }

  async function handleFiles(files) {
    const list = [...files].filter((file) => file.type.startsWith("video/") || /\.(mp4|m4v|webm|mov|ogg|ogv|mkv)$/i.test(file.name));
    for (const file of list) {
      try {
        const duration = await readDuration(file);
        await uploadFile(file, duration);
        await loadDashboard();
      } catch (error) {
        alert(file.name + ": " + error.message);
      }
    }
    fileInput.value = "";
  }

  chooseButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => handleFiles(fileInput.files));

  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add("dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove("dragging");
    });
  });

  dropzone.addEventListener("drop", (event) => handleFiles(event.dataTransfer.files));

  previewVideo.addEventListener("pause", () => {
    if (previewVideoId) setTimeout(() => syncPreview(true), 0);
  });
  previewVideo.addEventListener("ended", () => syncPreview(true));

  setInterval(() => syncPreview(false), 1000);
  setInterval(() => {
    if (!dashboard.hidden) loadDashboard().catch(() => {});
  }, 30000);

  checkSession();
})();
