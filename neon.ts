// Neon infrastructure as code: the Crosswalk demo is one Neon Function (page + API) next to the branch's Postgres.
// Deploy: EDIT_PASSCODE in .env.local (gitignored), then `npm run deploy`.
import { defineConfig } from '@neon/config/v1'

export default defineConfig({
  functions: {
    crosswalk: {
      name: 'Crosswalk demo',
      source: 'server/function.ts',
      env: { EDIT_PASSCODE: process.env.EDIT_PASSCODE! },
    },
  },
})
