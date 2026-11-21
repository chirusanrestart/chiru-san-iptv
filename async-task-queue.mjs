export class AsyncTaskQueue {
  constructor({ concurrency = 1, maxPending = 256 } = {}) {
    this.concurrency = Math.max(1, Math.floor(Number(concurrency) || 1));
    this.maxPending = Math.max(1, Math.floor(Number(maxPending) || 1));
    this.pending = [];
    this.active = 0;
    this.keys = new Set();
  }

  enqueue(key, task) {
    const id = String(key);
    if (this.keys.has(id) || this.pending.length >= this.maxPending) return false;
    if (typeof task !== "function") throw new TypeError("A tarefa da fila precisa ser uma função.");

    this.keys.add(id);
    this.pending.push({ key: id, task });
    this.drain();
    return true;
  }

  drain() {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const entry = this.pending.shift();
      this.active += 1;

      Promise.resolve()
        .then(entry.task)
        .catch(() => {})
        .finally(() => {
          this.active -= 1;
          this.keys.delete(entry.key);
          this.drain();
        });
    }
  }

  stats() {
    return {
      active: this.active,
      pending: this.pending.length,
      concurrency: this.concurrency,
      maxPending: this.maxPending
    };
  }
}
