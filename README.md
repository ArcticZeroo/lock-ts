# @arcticzeroo/lock

Concurrency control primitives for async JavaScript/TypeScript: **Lock**, **MultiLock**, and **Semaphore**.

## Installation

```bash
npm install @arcticzeroo/lock
```

## API

### `Lock`

A mutual exclusion lock. Only one `acquire` call runs at a time; others queue up in FIFO order.

```ts
import { Lock } from '@arcticzeroo/lock';

const lock = new Lock();

// Only one of these will run at a time
await Promise.all([
    lock.acquire(async () => {
        await writeToFile('hello');
    }),
    lock.acquire(async () => {
        await writeToFile('world');
    }),
]);

// Check how many callers are waiting
console.log(lock.queueLength);
```

### `MultiLock`

Manages independent locks keyed by string ID. Locks are created on demand and cleaned up automatically when their queue drains.

```ts
import { MultiLock } from '@arcticzeroo/lock';

const locks = new MultiLock();

// These two calls run concurrently (different IDs)
await Promise.all([
    locks.acquire('user-1', () => updateUser('user-1')),
    locks.acquire('user-2', () => updateUser('user-2')),
]);

// These two calls run sequentially (same ID)
await Promise.all([
    locks.acquire('user-1', () => updateUser('user-1')),
    locks.acquire('user-1', () => updateUser('user-1')),
]);
```

### `Semaphore`

Limits concurrency to a maximum number of simultaneous operations.

```ts
import { Semaphore } from '@arcticzeroo/lock';

// Allow up to 3 concurrent requests
const semaphore = new Semaphore(3);

const urls = [/* ... */];
await Promise.all(
    urls.map(url =>
        semaphore.acquire(() => fetch(url))
    )
);
```

Passing `undefined` (or no argument) disables the concurrency limit — `acquire` runs work immediately:

```ts
const semaphore = new Semaphore(); // no limit
await semaphore.acquire(() => doWork()); // runs immediately
```

### `MaybePromise<T>`

Utility type used by all `acquire` methods. Your work callback can return either `T` or `Promise<T>`.

```ts
import type { MaybePromise } from '@arcticzeroo/lock';
```

## License

MIT
