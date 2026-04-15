import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id:            string
      plan:          string
      emailVerified: Date | null
    } & DefaultSession['user']
  }
}
