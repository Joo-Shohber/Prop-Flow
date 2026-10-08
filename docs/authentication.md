# Authentication

All authentication logic lives in `src/auth/` (`AuthController`, `AuthService`, `PasswordService`, `OtpService`, `GoogleStrategy`) plus the `RefreshToken` entity. Every `/auth` route is `@Public()` (bypasses `JwtAuthGuard`). The controller is rate-limited as a group (`@Throttle({ default: { limit: 5, ttl: 60_000 } })`).

## Endpoint summary

| Method & path                        | Body / notes                                                                  | Success                                                            | Errors                                |
| ------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------- |
| `POST /auth/register`                | `{email, password (8–128), firstName, lastName, phone?, role: TENANT\|OWNER}` | `201` `{ message }`                                                | `400`, `409` duplicate email          |
| `POST /auth/login`                   | `{email, password}`                                                           | `200` `{accessToken, expiresIn, user}` + refresh cookie            | `401`, `403` deactivated / unverified |
| `POST /auth/refresh`                 | cookie only                                                                   | `200` `{accessToken, expiresIn}` + rotated cookie                  | `401`                                 |
| `POST /auth/logout`                  | cookie if present                                                             | `200`; family revoked and cookie cleared only if a cookie was sent | —                                     |
| `POST /auth/verify-email`            | `{email, otp}`                                                                | `200` message                                                      | `400`                                 |
| `POST /auth/resend-verification-otp` | `{email}`                                                                     | `200` generic message always                                       | —                                     |
| `POST /auth/forgot-password`         | `{email}`                                                                     | `200` generic message always                                       | —                                     |
| `POST /auth/reset-password`          | `{email, otp, newPassword}`                                                   | `200`; all sessions revoked; cookie cleared                        | `400`                                 |
| `GET /auth/google`                   | —                                                                             | redirect to Google                                                 | —                                     |
| `GET /auth/google/callback`          | —                                                                             | cookie + redirect to `FRONTEND_URL`                                | `403` deactivated                     |

## Registration

`RegisterDto.role` is `@IsIn([TENANT, OWNER])`. Passwords 8–128 characters. Email is normalized. Phone is optional and must match `/^\+?[0-9 ()-]{7,20}$/`.

Flow:

1. `409` if the email already exists.
2. Hash password, create user (`isEmailVerified: false`, default avatar).
3. Issue an email-verification OTP and send it. `EmailService.sendOtp` never throws, so SMTP/template failures still return `201`.

The response is a message, not the user object.

## Password hashing

`PasswordService`:

- Pre-hash with SHA-256, digest as **base64**, then `bcrypt` at cost **12**.
- `verify` wraps `bcrypt.compare` in try/catch and returns `false` on throw.
- `verifyDummy` runs a real compare against a cached dummy hash so “unknown email” and “wrong password” do similar work (`AuthService.login`).

## Access tokens

- Secret: `JWT_ACCESS_SECRET`, algorithm `HS256`.
- Payload signed by the app: `{ userId }` (Nest/JWT also add `iat` / `exp`). **Not** `{ sub }`.
- Lifetime: `JWT_ACCESS_EXPIRES_IN` (default `15m`), converted to seconds for `expiresIn` and `signAsync`.
- `JwtAuthGuard` verifies the Bearer token, requires `payload.userId` to be a string, loads the user with `UsersService.findById`, and rejects if the account is missing or `isActive` is false.
- Missing user: `findById` throws `404 User not found` rather than `401` (users are not hard-deleted in normal operation).
- Deactivation takes effect on the next authenticated request. Email verification is **not** re-checked on each request. It is enforced during password login, while Google accounts are created or linked as verified.

## Refresh tokens

- Secret: `JWT_REFRESH_SECRET`, `HS256`.
- Payload: `{ userId, jti, family }`.
- Row: `id` = `jti`, `tokenHash` = SHA-256 of the raw JWT, `expiresAt`, `revoked`.
- Cookie name `refresh_token`, path `/api/v1/auth`, `httpOnly: true`. Production: `secure: true`, `sameSite: 'none'`. Otherwise: `secure: false`, `sameSite: 'lax'`. `maxAge` from `JWT_REFRESH_EXPIRES_IN`.
- The raw refresh token is never returned in JSON.

`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must each be at least 32 characters. The Zod schema does not require them to be different values.

## Token rotation and reuse detection

`POST /auth/refresh`:

1. Verify JWT. Expired tokens return `401` “Expired refresh token”.
2. Load the row by `jti`. Missing row or `userId` / `family` mismatch returns `401`.
3. If `revoked` or the stored hash does not match the presented token, revoke the **family** and return `401` for token reuse.
4. If `expiresAt` is in the past, return `401`. Both JWT `exp` and the database expiration are checked.
5. If the user is missing or inactive, return `401`.
6. Inside a transaction, execute `UPDATE ... SET revoked = true WHERE id = :id AND revoked = false`. If `affected = 0`, treat the request as reuse and revoke the family. Otherwise, insert a new refresh-token row in the same family.

Concurrent refresh requests using the same token are therefore race-safe: only one request can successfully revoke the original row.

## Logout

If a refresh cookie is present, the handler verifies it on a best-effort basis and revokes that token family, then clears the cookie.

If no refresh cookie is present, the handler returns `200` without calling `clearCookie`.

## Email verification and OTP

Constants (`src/auth/constants/otp.constants.ts`): TTL **600s**, resend cooldown **60s**, max attempts **5**.

- Redis hash `otp:{purpose}:{email}` fields `hash` (HMAC-SHA256 of `purpose:email:code` with `OTP_SECRET`) and `attempts`.
- Cooldown key `otp:cooldown:{purpose}:{email}` (`SET EX 60 NX`). If cooldown is active, `issue()` returns `null` and no email is sent.
- Verify Lua script: correct → delete key (`OK`); wrong → increment; at 5 attempts → delete (`LOCKED`). All non-`OK` results are treated as invalid by `AuthService` (`400`).
- Purposes: `EMAIL_VERIFICATION`, `PASSWORD_RESET`.

`resend-verification-otp` sends only for an existing, **active**, **unverified** user. `forgot-password` sends only for an existing, **active**, **verified** user. Both always return the same generic message.

## Password reset

After a valid OTP, one transaction updates `passwordHash` and revokes every non-revoked refresh token for that user. The controller also clears the refresh cookie.

## Google OAuth

Requires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, and `FRONTEND_URL` (all required at process start).

`GoogleStrategy` scopes `email` and `profile`. Accounts without an email fail validation.

`AuthService.loginWithGoogle`:

1. Find by `googleId`.
2. Else find by email: if found and inactive → `403`; otherwise `linkGoogleAccount` sets `googleId` and `isEmailVerified: true`, and replaces the avatar only when `avatar.source === 'default'`.
3. Else `createFromGoogle`: role `TENANT`, `passwordHash: null`, `isEmailVerified: true`, Google avatar (`source: 'google'`).
4. If the resolved user is inactive → `403`.
5. Issue a new refresh-token family, set the refresh cookie, and **redirect to `FRONTEND_URL`**. No access token is placed in the URL. The SPA is expected to call `POST /auth/refresh`.

## Rate limiting

See README and `Redis.md`. Authentication endpoints are limited to **5 requests per 60 seconds per IP**, in addition to OTP resend cooldown and OTP attempt lockout.

## Token expiration summary

| Token   | Secret               | Default lifetime | Enforced                                 |
| ------- | -------------------- | ---------------- | ---------------------------------------- |
| Access  | `JWT_ACCESS_SECRET`  | 15 minutes       | `JwtAuthGuard`                           |
| Refresh | `JWT_REFRESH_SECRET` | 7 days           | JWT `exp` and `refresh_tokens.expiresAt` |

## Sequence notes

- Registration stores the OTP in Redis **before** attempting to send the email. Send errors are swallowed.
- Login uses `verifyDummy` when the email is unknown.
- Refresh rotation of the same token from two concurrent requests is protected by the conditional `UPDATE ... revoked = false`; only one request can successfully rotate the token.
