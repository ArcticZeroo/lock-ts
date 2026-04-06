import { describe, it, expect } from 'vitest';
import { Lock, MultiLock, Semaphore } from '../index.js';

function delay(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

// Helper: creates a deferred promise for fine-grained test control
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    return { promise, resolve };
}

describe('Lock', () => {
    it('should run a single acquire without blocking', async () => {
        const lock = new Lock();
        const result = await lock.acquire(() => 42);
        expect(result).toBe(42);
    });

    it('should work with async callbacks', async () => {
        const lock = new Lock();
        const result = await lock.acquire(async () => {
            await delay(10);
            return 'async-result';
        });
        expect(result).toBe('async-result');
    });

    it('should serialize concurrent acquires', async () => {
        const lock = new Lock();
        const order: number[] = [];

        const p1 = lock.acquire(async () => {
            await delay(30);
            order.push(1);
        });

        const p2 = lock.acquire(async () => {
            order.push(2);
        });

        const p3 = lock.acquire(async () => {
            order.push(3);
        });

        await Promise.all([p1, p2, p3]);
        expect(order).toEqual([1, 2, 3]);
    });

    it('should release the lock even if work throws', async () => {
        const lock = new Lock();

        await expect(lock.acquire(() => {
            throw new Error('oops');
        })).rejects.toThrow('oops');

        // Lock should be free — next acquire should work immediately
        const result = await lock.acquire(() => 'recovered');
        expect(result).toBe('recovered');
    });

    it('should release the lock even if async work rejects', async () => {
        const lock = new Lock();

        await expect(lock.acquire(async () => {
            throw new Error('async-oops');
        })).rejects.toThrow('async-oops');

        const result = await lock.acquire(() => 'recovered');
        expect(result).toBe('recovered');
    });

    it('should report queueLength correctly', async () => {
        const lock = new Lock();
        const gate = deferred();

        expect(lock.queueLength).toBe(0);

        const p1 = lock.acquire(() => gate.promise);

        // p1 holds the lock; queue two more
        const p2 = lock.acquire(() => {});
        const p3 = lock.acquire(() => {});

        // Wait a tick so waiters register
        await delay(0);
        expect(lock.queueLength).toBe(2);

        gate.resolve();
        await Promise.all([p1, p2, p3]);
        expect(lock.queueLength).toBe(0);
    });

    it('should not allow parallel execution inside the lock', async () => {
        const lock = new Lock();
        let concurrency = 0;
        let maxConcurrency = 0;

        const tasks = Array.from({ length: 5 }, () =>
            lock.acquire(async () => {
                concurrency++;
                maxConcurrency = Math.max(maxConcurrency, concurrency);
                await delay(10);
                concurrency--;
            })
        );

        await Promise.all(tasks);
        expect(maxConcurrency).toBe(1);
    });
});

describe('MultiLock', () => {
    it('should serialize work for the same id', async () => {
        const multi = new MultiLock();
        const order: number[] = [];

        const p1 = multi.acquire('a', async () => {
            await delay(30);
            order.push(1);
        });
        const p2 = multi.acquire('a', async () => {
            order.push(2);
        });

        await Promise.all([p1, p2]);
        expect(order).toEqual([1, 2]);
    });

    it('should allow parallel work for different ids', async () => {
        const multi = new MultiLock();
        let concurrency = 0;
        let maxConcurrency = 0;

        const work = async () => {
            concurrency++;
            maxConcurrency = Math.max(maxConcurrency, concurrency);
            await delay(20);
            concurrency--;
        };

        await Promise.all([
            multi.acquire('a', work),
            multi.acquire('b', work),
            multi.acquire('c', work),
        ]);

        expect(maxConcurrency).toBe(3);
    });

    it('should clean up locks when queue drains', async () => {
        const multi = new MultiLock();

        await multi.acquire('temp', () => {});

        // Internal map should have removed 'temp' — verify by acquiring again
        // (this is a behavioral test: a fresh lock is created each time)
        const order: number[] = [];
        const p1 = multi.acquire('temp', async () => {
            await delay(10);
            order.push(1);
        });
        const p2 = multi.acquire('temp', () => {
            order.push(2);
        });

        await Promise.all([p1, p2]);
        expect(order).toEqual([1, 2]);
    });

    it('should release lock for an id even if work throws', async () => {
        const multi = new MultiLock();

        await expect(multi.acquire('x', () => {
            throw new Error('fail');
        })).rejects.toThrow('fail');

        const result = await multi.acquire('x', () => 'ok');
        expect(result).toBe('ok');
    });
});

describe('Semaphore', () => {
    it('should throw RangeError for non-positive maxConcurrency', () => {
        expect(() => new Semaphore(0)).toThrow(RangeError);
        expect(() => new Semaphore(-1)).toThrow(RangeError);
    });

    it('should not throw for positive maxConcurrency', () => {
        expect(() => new Semaphore(1)).not.toThrow();
        expect(() => new Semaphore(100)).not.toThrow();
    });

    it('should run work immediately when no limit is set', async () => {
        const sem = new Semaphore();
        const result = await sem.acquire(() => 'unlimited');
        expect(result).toBe('unlimited');
    });

    it('should limit concurrency to maxConcurrency', async () => {
        const sem = new Semaphore(2);
        let concurrency = 0;
        let maxConcurrency = 0;

        const tasks = Array.from({ length: 10 }, () =>
            sem.acquire(async () => {
                concurrency++;
                maxConcurrency = Math.max(maxConcurrency, concurrency);
                await delay(20);
                concurrency--;
            })
        );

        await Promise.all(tasks);
        expect(maxConcurrency).toBeLessThanOrEqual(2);
        // With 10 tasks and delay, we should actually hit the limit
        expect(maxConcurrency).toBe(2);
    });

    it('should work as a mutex when maxConcurrency is 1', async () => {
        const sem = new Semaphore(1);
        let concurrency = 0;
        let maxConcurrency = 0;

        const tasks = Array.from({ length: 5 }, () =>
            sem.acquire(async () => {
                concurrency++;
                maxConcurrency = Math.max(maxConcurrency, concurrency);
                await delay(10);
                concurrency--;
            })
        );

        await Promise.all(tasks);
        expect(maxConcurrency).toBe(1);
    });

    it('should release slot even if work throws', async () => {
        const sem = new Semaphore(1);

        await expect(sem.acquire(() => {
            throw new Error('boom');
        })).rejects.toThrow('boom');

        // Slot should be free
        const result = await sem.acquire(() => 'fine');
        expect(result).toBe('fine');
    });

    it('should release slot even if async work rejects', async () => {
        const sem = new Semaphore(1);

        await expect(sem.acquire(async () => {
            await delay(5);
            throw new Error('async-boom');
        })).rejects.toThrow('async-boom');

        const result = await sem.acquire(() => 'recovered');
        expect(result).toBe('recovered');
    });

    it('should allow all concurrent when maxConcurrency is undefined', async () => {
        const sem = new Semaphore();
        let concurrency = 0;
        let maxConcurrency = 0;

        const tasks = Array.from({ length: 10 }, () =>
            sem.acquire(async () => {
                concurrency++;
                maxConcurrency = Math.max(maxConcurrency, concurrency);
                await delay(20);
                concurrency--;
            })
        );

        await Promise.all(tasks);
        expect(maxConcurrency).toBe(10);
    });

    it('should return the value from work', async () => {
        const sem = new Semaphore(3);
        const results = await Promise.all([
            sem.acquire(() => 1),
            sem.acquire(async () => 2),
            sem.acquire(() => 3),
        ]);
        expect(results).toEqual([1, 2, 3]);
    });
});
