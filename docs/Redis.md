# Redis

Redis serves three independent purposes in this project, all on one `ioredis` connection managed by `RedisService` (`src/common/redis/redis.service.ts`, `@Global()`). There is no message queue, pub/sub usage, or distributed lock beyond what is described below.

## Configuration

- Connected via `REDIS_HOST`, `REDIS_PORT`, optional `REDIS_PASSWORD`.
- `RedisService` wraps a single `ioredis` client with `maxRetriesPerRequest: 3`.
- Exposed methods: `getJson<T>(key)`, `setJson(key, value, ttlSeconds)`, `del(...keys)`, `delByPattern(pattern)`.
- `delByPattern` uses `client.scanStream({ match, count: 100 })` — a non-blocking, cursor-based `SCAN`, not `KEYS`, so cache invalidation does not block the Redis event loop even with a large keyspace.

## Cache usage

| Key pattern                             | Populated by                    | TTL | Invalidated by                                                                                                                                   |
| --------------------------------------- | ------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `units:search:{sha256(scope + query)}`  | `UnitsService.findAll`          | 60s | any unit create/update/delete/status change; lease `activate`/`terminate`; the lazy-expiration sweep (only if it actually changed rows)          |
| `dashboard:stats:{admin \| owner:<id>}` | `AnalyticsService.getDashboard` | 60s | the above, plus property create/update/delete/image change, and any maintenance status transition (`assign`/`start`/`complete`/`close`/`cancel`) |

The `units:search` key is computed by `UnitsService.buildSearchCacheKey`: a canonical object (`{ scope, status, propertyId, bedrooms, minArea, maxArea, page, limit, sortBy, sortOrder }`) is JSON-stringified in a fixed key order and SHA-256 hashed — `scope` is the caller's own ID for `OWNER`/`TENANT` or the literal string `admin`, which prevents one user's cached results from ever being served to another user with a different visibility scope.

Invalidation is a deliberate **full-pattern flush** (`delByPattern('units:search:*')` / `delByPattern('dashboard:stats:*')`), not a targeted single-key delete — every cached page/scope is dropped on a relevant write, rather than attempting to compute exactly which cached entries are now stale. The short TTL exists specifically as a safety net for this coarse strategy.

`CacheInvalidationService` (`@Global()`) exposes exactly two methods, `invalidateUnitsAndDashboard()` and `invalidateDashboard()`, and is the only component that calls `delByPattern` for cache purposes — every business service calls one of these two methods rather than constructing Redis patterns itself.

Cache invalidation always happens **after** the owning database transaction has committed, never inside it — Redis operations are not part of any PostgreSQL transaction and cannot be rolled back with it.

## OTP storage

Implemented in `OtpService` (`src/auth/otp.service.ts`):

- `otp:{purpose}:{email}` — a hash with fields `hash` (HMAC-SHA256 of the code, purpose, and email, keyed with `OTP_SECRET`) and `attempts` (integer). TTL: 10 minutes (`OTP_TTL_SECONDS`).
- `otp:cooldown:{purpose}:{email}` — a simple key set with `EX 60 NX`, used only to gate whether `issue()` generates a new code at all.
- Verification is a single Lua script (see the script body in `otp.service.ts`) executed via `client.eval`, making the read-check-increment-or-delete sequence atomic — two concurrent verification attempts against the same code cannot race past the attempt limit.

## Rate-limit storage

`RedisThrottlerStorage` (`src/common/throttler/redis-throttler-storage.service.ts`) implements `@nestjs/throttler`'s `ThrottlerStorage` interface directly, because the community Redis-backed storage packages available at the time did not declare compatibility with NestJS 12's peer dependency range.

- Keys: `throttle:{throttlerName:trackerKey}:hits` (an incrementing counter, `PEXPIRE`d to the configured window) and `...:block` (present only once the limit is exceeded, with the block duration as its TTL).
- A single Lua script performs: if a block key exists, return blocked with its remaining TTL without incrementing further; otherwise increment the hit counter (setting its expiry on the first hit in a window), and if the new count exceeds the limit, set the block key.
- Because the counter lives in Redis rather than in-process memory, the limit is enforced consistently across every running instance of the application, not per-process.

## Locks

No distributed lock (e.g. Redlock) is implemented. The one concurrency-sensitive flow that requires locking — lease activation/termination and maintenance state transitions — uses PostgreSQL row-level locking (`pessimistic_write`) instead; see `transactions.md`. Redis is not used for mutual exclusion anywhere in this project.

## Queues

Not implemented. There is no background job processing, and Redis is not used as a queue backend anywhere in the codebase.

## Failure behavior

- `RedisService` logs connection errors via the underlying `ioredis` client's `'error'` event (`RedisService: Redis error: ...`); it does not implement a circuit breaker, in-memory fallback, or automatic degradation.
- No component in the project catches a Redis connectivity error and degrades gracefully. The observable consequences of a sustained Redis outage, by code path:
  - **Rate limiting**: `ThrottlerGuard` is registered globally, and its storage call (`RedisThrottlerStorage.increment`) would throw, so effectively every request would fail, including login.
  - **OTP flows**: `OtpService.issue` / `verify` would throw, breaking email verification and password reset. Note that `AuthService.register` creates the user row _before_ requesting the OTP, so a Redis failure at that point leaves a created but unverified account and returns an error to the client.
  - **Caching**: `UnitsService.findAll` and `AnalyticsService.getDashboard` read and write the cache inline, so they would throw rather than fall back to querying the database directly.
  - **Cache invalidation**: runs after the database transaction has already committed, so a failure there would surface an error to the client for a write that did in fact succeed.
- Login itself does not read or write Redis directly (the dummy hash used for timing equalization is held in process memory by `PasswordService`); it is affected only through the global throttler guard above.
- Adding a fallback (e.g. treating cache misses/errors as "no cache", or failing open on the throttler) is a possible improvement, but it is **not implemented**.
