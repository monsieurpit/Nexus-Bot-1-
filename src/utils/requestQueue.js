// src/utils/requestQueue.js
// FIFO Asynchronous Request Queue with 45s Timeout Guards and Crash Protection

class RequestQueue {
  constructor({ concurrency = 6, timeoutMs = 45000 } = {}) {
    this.concurrency = concurrency;
    this.timeoutMs = timeoutMs;
    this.queue = [];
    this.activeCount = 0;
    this.totalProcessed = 0;
    this.totalErrors = 0;
  }

  get stats() {
    return {
      queueLength: this.queue.length,
      activeRequests: this.activeCount,
      totalProcessed: this.totalProcessed,
      totalErrors: this.totalErrors,
      concurrencyLimit: this.concurrency
    };
  }

  /**
   * Enqueues an async task and returns a Promise that resolves with task output
   */
  enqueue(taskFn) {
    const enqueueTime = Date.now();

    return new Promise((resolve, reject) => {
      const queueItem = {
        taskFn,
        enqueueTime,
        resolve,
        reject
      };

      this.queue.push(queueItem);
      setImmediate(() => this.processNext());
    });
  }

  async processNext() {
    if (this.activeCount >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    this.activeCount++;
    const startTime = Date.now();
    const waitedInQueueMs = startTime - item.enqueueTime;

    let timer;
    let completed = false;

    const timeoutPromise = new Promise((_, rej) => {
      timer = setTimeout(() => {
        if (!completed) {
          completed = true;
          this.totalErrors++;
          rej(new Error(`Request timed out after ${this.timeoutMs}ms in execution guard`));
        }
      }, this.timeoutMs);
    });

    try {
      const result = await Promise.race([item.taskFn(), timeoutPromise]);
      completed = true;
      clearTimeout(timer);
      this.totalProcessed++;
      const executionTimeMs = Date.now() - startTime;

      item.resolve({
        result,
        telemetry: {
          waitedInQueueMs,
          executionTimeMs,
          totalQueueTimeMs: waitedInQueueMs + executionTimeMs
        }
      });
    } catch (err) {
      completed = true;
      clearTimeout(timer);
      this.totalErrors++;
      item.reject(err);
    } finally {
      this.activeCount--;
      setImmediate(() => this.processNext());
    }
  }
}

export const globalAiQueue = new RequestQueue({ concurrency: 8, timeoutMs: 45000 });
