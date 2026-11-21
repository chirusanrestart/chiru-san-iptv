import test from "node:test";
import assert from "node:assert/strict";
import { AsyncTaskQueue } from "../async-task-queue.mjs";

const turn = () => new Promise((resolve) => setImmediate(resolve));

test("runs queued tasks concurrently but starts them in FIFO order", async () => {
  const queue = new AsyncTaskQueue({ concurrency: 2, maxPending: 4 });
  const started = [];
  const releases = new Map();

  for (const key of ["a", "b", "c", "d"]) {
    queue.enqueue(key, () => new Promise((resolve) => {
      started.push(key);
      releases.set(key, resolve);
    }));
  }

  await turn();
  assert.deepEqual(started, ["a", "b"]);
  assert.equal(queue.stats().active, 2);
  assert.equal(queue.stats().pending, 2);

  releases.get("b")();
  await turn();
  assert.deepEqual(started, ["a", "b", "c"]);

  releases.get("a")();
  await turn();
  assert.deepEqual(started, ["a", "b", "c", "d"]);

  releases.get("c")();
  releases.get("d")();
  await turn();
  assert.deepEqual(queue.stats(), { active: 0, pending: 0, concurrency: 2, maxPending: 4 });
});

test("deduplicates queued and running keys", async () => {
  const queue = new AsyncTaskQueue({ concurrency: 1 });
  let release;
  let runs = 0;
  queue.enqueue("same", () => new Promise((resolve) => {
    runs += 1;
    release = resolve;
  }));
  assert.equal(queue.enqueue("same", async () => { runs += 1; }), false);
  await turn();
  assert.equal(queue.enqueue("same", async () => { runs += 1; }), false);
  release();
  await turn();
  assert.equal(runs, 1);
});

test("rejects new work when the pending queue is full", () => {
  const queue = new AsyncTaskQueue({ concurrency: 1, maxPending: 1 });
  let release;
  queue.enqueue("active", () => new Promise((resolve) => { release = resolve; }));
  queue.enqueue("pending", async () => {});
  assert.equal(queue.enqueue("overflow", async () => {}), false);
  assert.equal(queue.stats().pending, 1);
  release?.();
});
