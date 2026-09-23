import test from "node:test";
import assert from "node:assert/strict";
import { cycleDuration, orderedActiveVideos, resolveLivePosition } from "../server/schedule.js";

const videos = [
  { id: "b", title: "B", duration: 20, order: 1, enabled: true },
  { id: "a", title: "A", duration: 10, order: 0, enabled: true },
  { id: "off", title: "Off", duration: 99, order: 2, enabled: false }
];

test("active playlist stays in explicit order", () => {
  assert.deepEqual(orderedActiveVideos(videos).map((video) => video.id), ["a", "b"]);
  assert.equal(cycleDuration(videos), 30);
});

test("every active video plays before the rotation loops", () => {
  const epoch = 1_000_000;
  assert.equal(resolveLivePosition(videos, epoch, epoch + 5_000).video.id, "a");
  assert.equal(resolveLivePosition(videos, epoch, epoch + 15_000).video.id, "b");
  assert.equal(resolveLivePosition(videos, epoch, epoch + 29_000).video.id, "b");
  assert.equal(resolveLivePosition(videos, epoch, epoch + 31_000).video.id, "a");
});

test("viewer offset is derived from wall clock", () => {
  const epoch = 2_000_000;
  const live = resolveLivePosition(videos, epoch, epoch + 17_500);
  assert.equal(live.video.id, "b");
  assert.equal(live.offset, 7.5);
});
