# Security

Each mechanism below is documented as: the threat it addresses, and how the implementation mitigates it. Nothing in this document is aspirational — every item is backed by a specific file/class named.

## Password storage

**Threat**: database compromise exposing reversible or crackable passwords.
**Mitigation**: `PasswordService` — SHA-256 pre-hash (so the entire password contributes, not just the first 72 bytes, which is `bcrypt`'s own input limit) followed by `bcrypt` at cost factor 12. Bcrypt is deliberately slow, which raises the cost of an offline brute-force attempt against a leaked hash.

## Login timing / account enumeration

**Threat**: an attacker distinguishing "wrong password" from "account does not exist" via response timing, to enumerate valid emails.
**Mitigation**: `AuthService.login` calls `PasswordService.verifyDummy` (a real `bcrypt.compare` against a cached dummy hash) on the "user not found" path, so both branches perform a comparable amount of work. `forgot-password` and `resend-verification-otp` return an identical, generic message regardless of whether the account exists.

## JWT integrity and secret separation

**Threat**: a compromised or forged token granting unintended access; a leaked access-token secret also compromising refresh tokens.
**Mitigation**: access and refresh tokens are signed with two independent secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`), both required to be at least 32 characters and to differ from each other (enforced by the `zod` schema's `.refine`). Algorithm is pinned to `HS256` on both sign and verify.

## Refresh token theft / replay

**Threat**: a stolen refresh token being used after the legitimate client has already rotated it (e.g. exfiltrated from logs, a proxy, or a compromised device).
**Mitigation**: token rotation with reuse detection (`AuthService.refresh`) — every use invalidates the token and issues a new one in the same `family`; presenting an already-used token revokes the entire family, forcing re-authentication. The raw token is never stored, only its SHA-256 hash, so a database read alone cannot be replayed as a valid token. Refresh tokens are also never returned in a JSON body, only set as an httpOnly cookie.

## Cookie security

**Threat**: refresh-token theft via XSS (client-side script reading the token) or cross-site request forgery.
**Mitigation**: `httpOnly: true` (inaccessible to JavaScript); `secure: true` and `sameSite: 'none'` in production (requires HTTPS, and explicit cross-site cookie handling rather than silent same-site defaults); the cookie's `path` is scoped to `/api/v1/auth`, so it is never sent to unrelated routes.

## CORS

**Threat**: an arbitrary origin making authenticated, credentialed requests against the API.
**Mitigation**: `CORS_ORIGINS` is a required, explicit allow-list (`app.enableCors({ origin: [...], credentials: true })`) — there is no wildcard origin configuration.

## HTTP headers

**Threat**: common browser-side attack vectors (clickjacking, MIME sniffing, etc.).
**Mitigation**: `helmet()` applied globally in `app.setup.ts`.

## Brute force / abuse of sensitive endpoints

**Threat**: credential stuffing against `/auth/login`, OTP guessing against `/auth/verify-email`, or general request flooding.
**Mitigation**: the intended configuration is a class-level `@Throttle({ default: { limit: 5, ttl: 60_000 } })` on `AuthController`, limiting every auth endpoint to 5 requests/minute per client; a global default of 100 requests/minute/IP applies elsewhere. Enforced by `RedisThrottlerStorage`, a hand-written, Lua-script-based, atomic counter shared across all running instances (not per-process), so the limit cannot be bypassed by hitting a different server instance.

> **Verify:** during development the decorator was initially applied to `register` only, and a later change moved it to class level. Confirm that `@Throttle` is present on `AuthController` (or on every sensitive route individually); a route without it falls back to the 100 requests/minute global default, not the stricter auth limit.

## OTP guessing

**Threat**: brute-forcing a 6-digit verification/reset code (1,000,000 possibilities — feasible to guess without a lockout).
**Mitigation**: `OtpService` stores an HMAC-SHA256 hash of the code (keyed with `OTP_SECRET`), not the code itself, so a Redis compromise alone does not reveal valid codes. A single atomic Lua script enforces: correct code is single-use (deleted on success); five wrong attempts delete the code even without ever guessing correctly (a hard lockout, not just a counter); a separate 60-second cooldown key limits how often a new code can be requested.

## Broken access control (RBAC bypass, IDOR)

**Threat**: a user acting outside their role, or acting correctly-roled but against a resource they do not own.
**Mitigation**: two independent layers — global `RolesGuard` for coarse role checks, and explicit resource-level policy functions (`common/policies/policy.utils.ts`) called from every service before a read or write. See `authorization.md` for the full breakdown.

## Malicious or spoofed file uploads

**Threat**: a client uploading a non-image file disguised with an image extension or a forged `Content-Type` (e.g. an executable, script, or polyglot file).
**Mitigation**: `UploadService` validates the **actual file bytes** via `file-type` (magic-number detection) against an explicit allow-list (`jpeg`, `png`, `webp`) — the client-supplied filename and MIME type are never trusted. Size (5 MB) and per-request count are capped both at the `multer` layer (`limits.fileSize`) and again in the service.

## SQL injection

**Threat**: unsanitized input reaching a raw query.
**Mitigation**: all data access goes through TypeORM's parameterized query builder / repository API; user-supplied values are always passed as bound parameters. Two places build SQL text from code rather than input: the `ORDER BY` column in query-builder searches is interpolated, but only after `resolveSort` restricts it to a hard-coded per-resource whitelist (any other `sortBy` value returns `400`); and the analytics aggregate queries use constant SQL fragments. Separately, `LeaseExpirationService.run()`, `LeaseExpirationService.run()` issues raw SQL through `QueryRunner.query()` with a parameterized placeholder (`$1`) for the `ANY($1::uuid[])` clause; no user input is interpolated into that SQL string.

## Mass assignment / over-posting

**Threat**: a client supplying extra fields not intended to be settable (e.g. `role: ADMIN` on a public registration form, or `ownerId` on a non-admin property creation).
**Mitigation**: `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` globally strips/rejects any field not declared on the target DTO. Fields that exist on a DTO but must not be trusted from a non-privileged caller (e.g. `CreatePropertyDto.ownerId`) are explicitly re-validated or overwritten in the service layer, not merely relied upon to be absent from the request.

## Account activation state

**Threat**: a deactivated or unverified account continuing to act, e.g. via an access token issued before deactivation.
**Mitigation**: `JwtAuthGuard` re-loads the `User` row and checks `isActive` on **every** request, not only at login — deactivation takes effect immediately, mid-session. Login itself additionally checks `isEmailVerified`.

## Sensitive data exposure

**Threat**: password hashes or other sensitive columns leaking through an ordinary query result.
**Mitigation**: `User.passwordHash` is declared `select: false`; it is only fetched by the one query built explicitly for credential verification (`UsersService.findCredentialsByEmail`), which selects it by name. Every other `User` read (including the response shape returned to clients) omits it implicitly.

## Error handling and information leakage

**Threat**: stack traces or internal error messages exposed to clients, aiding an attacker in fingerprinting the stack or discovering internal state.
**Mitigation**: `AllExceptionsFilter` (global) normalizes every thrown error into a consistent shape and, when `NODE_ENV=production`, replaces any non-`HttpException` error's message with a generic `"Internal server error"` rather than the underlying exception's own message. It also maps specific PostgreSQL error codes (`23505`, `23P01`, `23503`, `23514`, `23502`, `22001`, `22P02`) to the appropriate HTTP status rather than surfacing a raw database error to the client.

## Database-level integrity as a security backstop

**Threat**: an application-layer bug (a missed check, a race condition) silently corrupting data in a way that has security or business consequences (e.g. two overlapping leases on one unit, or a lease with reversed dates).
**Mitigation**: the `CHECK` and `EXCLUDE` constraints and the partial unique index on `leases` (see `database.md`) hold regardless of what the application code does — including under concurrent requests — because PostgreSQL enforces them at commit time, not the application.
