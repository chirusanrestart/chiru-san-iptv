import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HlsRuntime } from "../runtime.mjs";

test("limits only live FFmpeg jobs", () => {
  const runtime = new HlsRuntime({ maxJobs: 1 });
  runtime.setJob("a", { child: { kill() {} }, startedAt: Date.now(), exitCode: null });
  assert.equal(runtime.canStartJob(), false);
  runtime.getJob("a").exitCode = 0;
  assert.equal(runtime.canStartJob(), true);
});

test("tracks concurrent sessions and releases each only once", () => {
  const runtime = new HlsRuntime();
  const releaseA = runtime.acquire("video");
  const releaseB = runtime.acquire("video");
  assert.equal(runtime.activeSessionCount(), 2);
  releaseA(); releaseA();
  assert.equal(runtime.activeSessionCount(), 1);
  releaseB();
  assert.equal(runtime.activeSessionCount(), 0);
});

test("stops idle jobs but preserves jobs with active sessions", async () => {
  const runtime = new HlsRuntime();
  let killed = 0;
  runtime.setJob("idle", { child: { kill() { killed++; } }, startedAt: 1, exitCode: null });
  runtime.setJob("busy", { child: { kill() { killed++; } }, startedAt: 1, exitCode: null });
  runtime.getJob("idle").lastActivityAt = 1;
  runtime.getJob("busy").lastActivityAt = 1;
  const release = runtime.acquire("busy");
  assert.deepEqual(await runtime.sweepIdle({ idleMs: 100, now: 1000 }), ["idle"]);
  assert.equal(killed, 1);
  assert.ok(runtime.getJob("busy"));
  release();
});

test("counts cached bytes, HLS segments and playlists", async () => {
  const runtime = new HlsRuntime();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "iptv-cache-"));
  await fs.writeFile(path.join(dir, "segment_000001.ts"), Buffer.alloc(12));
  await fs.writeFile(path.join(dir, "index.m3u8"), "#EXTM3U");
  assert.deepEqual(await runtime.cacheStats(dir), { bytes: 19, segments: 1, playlists: 1, directories: 0 });
  await fs.rm(dir, { recursive: true, force: true });
});

test("prunes stale cache directories but preserves active ones", async () => {
  const runtime = new HlsRuntime();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "iptv-prune-"));
  const stale = path.join(root, "stale");
  const active = path.join(root, "active");
  await fs.mkdir(stale); await fs.mkdir(active);
  const old = new Date(Date.now() - 10_000);
  await fs.utimes(stale, old, old); await fs.utimes(active, old, old);
  assert.equal(await runtime.pruneCache(root, { maxAgeMs: 1000, protectedDirs: [active] }), 1);
  await assert.rejects(fs.stat(stale), { code: "ENOENT" });
  await fs.stat(active);
  await fs.rm(root, { recursive: true, force: true });
});

test("removes finished jobs from the runtime registry after retention", async () => {
  const runtime = new HlsRuntime();
  runtime.setJob("done", { child: { kill() {} }, startedAt: 1, exitCode: 0, closedAt: 1 });
  await runtime.sweepIdle({ now: 100_000, finishedRetentionMs: 1000 });
  assert.equal(runtime.getJob("done"), null);
});

test("shares one in-flight FFmpeg start for concurrent requests to the same video", async () => {
  const runtime = new HlsRuntime({ maxJobs: 1 });
  let starts = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const factory = async () => {
    starts++;
    await gate;
    return { child: { kill() {} }, startedAt: Date.now(), exitCode: null };
  };
  const first = runtime.startJob("same-video", factory);
  const second = runtime.startJob("same-video", factory);
  await Promise.resolve();
  assert.equal(starts, 1);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.equal(runtime.jobs.size, 1);
});

test("counts concurrent starts toward the FFmpeg limit", async () => {
  const runtime = new HlsRuntime({ maxJobs: 1 });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const pending = runtime.startJob("first", async () => {
    await gate;
    return { child: { kill() {} }, startedAt: Date.now(), exitCode: null };
  });
  await assert.rejects(runtime.startJob("second", async () => ({})), { code: "HLS_LIMIT" });
  release();
  await pending;
});
