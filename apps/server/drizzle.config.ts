import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { defineConfig } from 'drizzle-kit'
import './src/app/load-env'

const databasePath = resolve(process.cwd(), process.env.DATABASE_PATH ?? './var/05_04_api.sqlite')

mkdirSync(dirname(databasePath), { recursive: true })

export default defineConfig({
  dbCredentials: {
    url: databasePath,
  },
  dialect: 'sqlite',
  out: './drizzle',
  schema: './src/db/schema/index.ts',
})
