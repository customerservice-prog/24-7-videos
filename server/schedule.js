export function orderedActiveVideos(videos = []) {
  return [...videos]
    .filter((video) => video.enabled !== false && Number.isFinite(Number(video.duration)) && Number(video.duration) > 0)
    .sort((a, b) => {
      const orderDiff = Number(a.order || 0) - Number(b.order || 0);
      if (orderDiff !== 0) return orderDiff;
      return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    });
}

export function cycleDuration(videos = []) {
  return orderedActiveVideos(videos).reduce((total, video) => total + Number(video.duration), 0);
}

export function resolveLivePosition(videos = [], scheduleEpoch, now = Date.now()) {
  const active = orderedActiveVideos(videos);
  const total = active.reduce((sum, video) => sum + Number(video.duration), 0);

  if (!active.length || total <= 0) {
    return { active, cycleDuration: 0, elapsedInCycle: 0, index: -1, video: null, offset: 0, nextVideo: null };
  }

  const elapsedSeconds = Math.max(0, (Number(now) - Number(scheduleEpoch || now)) / 1000);
  const elapsedInCycle = elapsedSeconds % total;
  let cursor = 0;

  for (let index = 0; index < active.length; index += 1) {
    const video = active[index];
    const end = cursor + Number(video.duration);
    if (elapsedInCycle < end || index === active.length - 1) {
      return {
        active,
        cycleDuration: total,
        elapsedInCycle,
        index,
        video,
        offset: Math.max(0, elapsedInCycle - cursor),
        nextVideo: active[(index + 1) % active.length]
      };
    }
    cursor = end;
  }

  return { active, cycleDuration: total, elapsedInCycle, index: 0, video: active[0], offset: 0, nextVideo: active[1] || active[0] };
}
