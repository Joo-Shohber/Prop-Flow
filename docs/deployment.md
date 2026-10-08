# Deployment

## Runtime requirements

- Node.js **>= 22.12** (the project is ESM-only and `package.json` declares `engines.node`). See "Known deployment issue" below for why the exact runtime version matters.

- PostgreSQL, with permission to run `CREATE EXTENSION` for `uuid-ossp` and `btree_gist` (the initial migration creates both explicitly).

- Redis, reachable from every application instance.

- A Cloudinary account, an SMTP provider, and Google OAuth credentials if Google sign-in is enabled.

## Environment variables

All variables are validated at startup by the `zod` schema in `src/config/env.validation.ts`; the process exits with a descriptive error if a required variable is missing or malformed. Values are never committed; `.env.example` lists names only.

| Variable                                                               | Required                                        | Notes                                                                                                                                    |
| ---------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                             | no (default `development`)                      | `production` enables Postgres SSL, `secure` + `sameSite=none` cookies, and generic error messages.                                       |
| `PORT`                                                                 | no (default `3000`)                             | Used by `src/main.ts`; not relevant to the Vercel entry point.                                                                           |
| `CORS_ORIGINS`                                                         | yes                                             | Comma-separated origin allow-list.                                                                                                       |
| `FRONTEND_URL`                                                         | yes                                             | Used by the Google OAuth callback as the redirect destination after authentication.                                                      |
| `DATABASE_URL`                                                         | yes                                             | Must start with `postgres://` or `postgresql://`.                                                                                        |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`                           | host required                                   | Port defaults to `6379`; password optional.                                                                                              |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`                              | yes                                             | Each must be at least 32 characters. The current Zod schema does not require the two values to differ.                                   |
| `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`                      | no                                              | Defaults `15m` / `7d`; format `<n>[smhd]`.                                                                                               |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | yes                                             | Required for Cloudinary-backed image operations.                                                                                         |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`    | host and `MAIL_FROM` required                   | Port `465` uses implicit TLS; other ports use STARTTLS when offered. Credentials are optional for unauthenticated relays.                |
| `OTP_SECRET`                                                           | yes                                             | At least 32 characters; HMAC key for OTP hashing.                                                                                        |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`                              | only for the seed script                        | Used by `npm run seed:admin`.                                                                                                            |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`      | required by the schema as currently implemented | The callback URL must exactly match the one registered in Google Cloud Console and point at the deployed `/api/v1/auth/google/callback`. |

> **Verify:** The Google variables are currently required by the environment schema. An environment that does not use Google sign-in still has to provide placeholder values unless the schema is changed to make them optional.

## Build and migrations

| Command                    | Purpose                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`            | Compiles TypeScript to `dist/`. `nest-cli.json` copies `src/common/mail/templates/**` into `dist/` as assets.                            |
| `npm run migration:run`    | Applies pending migrations via `src/database/data-source.ts` (TypeORM CLI, ESM-aware).                                                   |
| `npm run migration:revert` | Reverts the most recent migration.                                                                                                       |
| `npm run seed:admin`       | Builds, then runs `dist/database/seeds/seed-admin.js` to create the first `ADMIN`. Idempotent: does nothing if the email already exists. |
| `npm run start:prod`       | Runs the compiled application for a conventional Node host.                                                                              |

Migrations are the only supported way to change the schema; `synchronize` is disabled in every environment. The recommended order on a fresh environment is: set variables, `migration:run`, `seed:admin`, start the application.

## Production configuration

Behavior controlled by `NODE_ENV=production`:

- PostgreSQL connection uses SSL with `rejectUnauthorized: false` (both in the runtime `TypeOrmModule` configuration and in `data-source.ts`). This encrypts the connection but does **not** verify the server certificate; it is a pragmatic setting for managed providers with self-signed or provider-signed chains, and a hardening candidate (supplying the provider's CA and enabling verification).

- The refresh-token cookie is `secure` with `sameSite: 'none'` — the deployment must be served over HTTPS, and browsers will reject the cookie otherwise.

- `AllExceptionsFilter` replaces internal error messages with a generic message.

- `app.setup.ts` sets Express `trust proxy` to `1`, so `req.ip` (used by the rate limiter and recorded in audit logs) reflects the client address behind a single reverse proxy rather than the proxy's address.

## Vercel

Files: `api/index.ts` and `vercel.json`.

- `api/index.ts` creates the Express instance and bootstraps the Nest application **once per serverless instance**, memoizing the bootstrap promise; subsequent invocations on a warm instance reuse it. The exported handler awaits that promise and then delegates to the Express server.

- `vercel.json` uses the legacy `builds` + `routes` configuration, routing every path to `api/index.ts`.

- Recommended Build Command: `npm run migration:run && npm run build`, so the schema is migrated before the new version serves traffic. This requires `DATABASE_URL` to be available at build time and dev dependencies (the TypeORM CLI runs through `ts-node`) to be installed during the build.

- Lazy lease expiration (see `business-logic.md`) needs no scheduler, which suits a serverless deployment with no long-running process.

### Known deployment issue (open at time of writing)

Deployed functions failed on requests with `ERR_REQUIRE_ESM`: a CommonJS dependency's compiled file attempted `require('@nestjs/common')`, while `@nestjs/common` in NestJS 12 is published as pure ESM (`"type": "module"`, no CommonJS entry).

The first occurrence was in `@nestjs-modules/mailer` (resolved by removing that package and calling `nodemailer` and `ejs` directly); the same error then appeared in `@nestjs/throttler`, which is CommonJS.

The root cause identified is the **Node.js runtime version used by the deployed function**. `require()` of an ES module is supported in Node versions that include the required `require(esm)` behavior, including Node 20.19+ and 22.12+. The project therefore requires Node.js `>=22.12`, and the deployed runtime must actually use a compatible version.

Because the error was still observed after a runtime setting change, the issue is **not considered confirmed resolved**. Steps taken/recommended:

- Vercel's Node runtime must be verified against the actual `process.version` used by the function. Do not rely only on the dashboard setting or `package.json` declaration.

- Log `process.version` at the top of `api/index.ts` temporarily to confirm which runtime actually serves requests.

- If `engines.node` is changed to an exact Vercel-supported runtime such as `"22.x"`, verify the resulting deployed runtime rather than assuming the setting alone fixes the issue.

- If a runtime that supports `require(esm)` cannot be guaranteed, `@nestjs/throttler` would have to be replaced with a locally written guard (the storage implementation already is), or the deployment moved to a conventional Node host where `npm run start:prod` runs on a controlled Node version.

## Other deployment considerations

- **Database connections under serverless concurrency.** Each concurrent function instance opens its own TypeORM connection pool; no explicit pool size limit is configured, so a burst of concurrent instances can exceed the managed database's connection cap. A pooler or an explicit `extra.max` setting is not currently configured.

- **Template files at runtime.** `EmailService` reads `otp.ejs` from disk relative to its own compiled location. Whether Vercel's file tracing includes that non-imported file in the function bundle must be verified; if OTP emails fail on Vercel with a file-not-found error (they are logged and not surfaced to the client), the template needs to be included explicitly in the function's bundled files.

- **Redis is a hard dependency** of every request through the global throttler guard (see `redis.md`).

- **HTTPS and cookies.** Because the refresh cookie uses `sameSite: 'none'` in production, a frontend on a different registrable domain works only over HTTPS end to end. Local development uses `sameSite: 'lax'` and therefore assumes the frontend reaches the API through a same-site proxy.
