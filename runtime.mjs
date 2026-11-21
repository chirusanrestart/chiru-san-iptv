import fs from "node:fs/promises";
import path from "node:path";

export class HlsRuntime {
  constructor({ maxJobs = 2 } = {}) {
    this.maxJobs = maxJobs;
    this.jobs = new Map();
    this.sessions = new Map();
    this.starts = new Map();
  }

  getJob(id) { return this.jobs.get(String(id)) || null; }
  deleteJob(id) { return this.jobs.delete(String(id)); }

  async startJob(id, factory) {
    const key = String(id);
    const existing = this.getJob(key);
    if (existing && !existing.error && (existing.exitCode === null || existing.exitCode === 0)) return existing;
    if (this.starts.has(key)) return this.starts.get(key);
    if (!this.canStartJob()) {
      const error = new Error(`FFmpeg concurrency limit (${this.maxJobs}) reached`);
      error.code = "HLS_LIMIT";
      throw error;
    }
    const pending = Promise.resolve().then(factory).then((job) => this.setJob(key, job)).finally(() => this.starts.delete(key));
    this.starts.set(key, pending);
    return pending;
  }

  activeJobCount() {
    return [...this.jobs.values()].filter((job) => job.exitCode === null && !job.error).length + this.starts.size;
  }

  canStartJob() { return this.activeJobCount() < this.maxJobs; }

  setJob(id, job) {
    this.jobs.set(String(id), job);
    job.lastActivityAt = Date.now();
    return job;
  }

  touch(id) {
    const job = this.getJob(id);
    if (job) job.lastActivityAt = Date.now();
  }

  acquire(id) {
    const key = String(id);
    this.sessions.set(key, (this.sessions.get(key) || 0) + 1);
    this.touch(key);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = this.sessions.get(key) || 0;
      if (count <= 1) this.sessions.delete(key);
      else this.sessions.set(key, count - 1);
      this.touch(key);
    };
  }

  activeSessionCount() {
    let total = 0;
    for (const count of this.sessions.values()) total += count;
    return total;
  }

  async sweepIdle({ idleMs = 90_000, finishedRetentionMs = 3_600_000, now = Date.now() } = {}) {
    const stopped = [];
    for (const [id, job] of this.jobs) {
      if ((this.sessions.get(id) || 0) > 0) continue;
      if (job.exitCode !== null || job.error) {
        if (now - (job.closedAt || job.lastActivityAt || job.startedAt || now) >= finishedRetentionMs) this.jobs.delete(id);
        continue;
      }
      if (now - (job.lastActivityAt || job.startedAt || now) < idleMs) continue;
      job.child.kill("SIGTERM");
      this.jobs.delete(id);
      stopped.push(id);
    }
    return stopped;
  }

  async cacheStats(cacheDir) {
    let bytes = 0, segments = 0, playlists = 0, directories = 0;
    const walk = async (dir) => {
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); }
      catch (error) { if (error.code === "ENOENT") return; throw error; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { directories++; await walk(full); continue; }
        if (!entry.isFile()) continue;
        const stat = await fs.stat(full);
        bytes += stat.size;
        if (/^segment_\d+\.ts$/.test(entry.name)) segments++;
        if (entry.name.endsWith(".m3u8")) playlists++;
      }
    };
    await walk(cacheDir);
    return { bytes, segments, playlists, directories };
  }

  async pruneCache(cacheDir, { maxAgeMs = 86_400_000, protectedDirs = [], now = Date.now() } = {}) {
    const protectedSet = new Set(protectedDirs.map((dir) => path.resolve(dir)));
    let removed = 0;
    let entries;
    try { entries = await fs.readdir(cacheDir, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return 0; throw error; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const target = path.resolve(cacheDir, entry.name);
      if (protectedSet.has(target)) continue;
      const stat = await fs.stat(target);
      if (now - stat.mtimeMs < maxAgeMs) continue;
      await fs.rm(target, { recursive: true, force: true });
      removed++;
    }
    return removed;
  }

  async stats(cacheDir) {
    return {
      uptimeSeconds: Math.floor(process.uptime()),
      memory: process.memoryUsage(),
      jobs: [...this.jobs.values()].map((job) => ({
        running: job.exitCode === null && !job.error,
        exitCode: job.exitCode,
        ageSeconds: Math.max(0, Math.floor((Date.now() - job.startedAt) / 1000)),
        idleSeconds: Math.max(0, Math.floor((Date.now() - (job.lastActivityAt || job.startedAt)) / 1000))
      })),
      activeSessions: this.activeSessionCount(),
      cache: await this.cacheStats(cacheDir)
    };
  }
}
