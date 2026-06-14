# Server local development

This file intentionally does not contain local credentials.

## Local seed account

Use the root setup wizard to create a local database, seed an account, and optionally write the generated credentials to the ignored root `.credentials.json` file:

```bash
npm run setup
```

The seed script is:

- `apps/server/src/db/seed-main-account.ts`

The generated local seed manifest is ignored under:

- `apps/server/var/main-account-seed.json`

## Manual reset

From `apps/server`:

```bash
rm -f var/05_04_api.sqlite var/05_04_api.sqlite-shm var/05_04_api.sqlite-wal var/main-account-seed.json
npm run db:migrate
npm run db:seed
```

Or from the repository root:

```bash
npm run db:migrate --workspace @wonderlands/server
npm run db:seed --workspace @wonderlands/server
```

Do not commit `.env`, `.credentials.json`, database files, or anything under `apps/server/var/`.
