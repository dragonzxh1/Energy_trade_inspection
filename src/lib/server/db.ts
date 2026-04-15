import { Pool } from 'pg'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL is required')
}

declare global {
  // eslint-disable-next-line no-var
  var __etiPool: Pool | undefined
}

export const db =
  global.__etiPool ??
  new Pool({
    connectionString,
    max: 10,
  })

if (process.env.NODE_ENV !== 'production') {
  global.__etiPool = db
}

