import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import Credentials from 'next-auth/providers/credentials'
import PostgresAdapter from '@auth/pg-adapter'
import { db } from '@/lib/server/db'
import { verifyPassword } from '@/lib/server/password'

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  adapter: PostgresAdapter(db),

  providers: [
    Google({
      clientId:     process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),

    Credentials({
      credentials: {
        email:    { label: 'Email',    type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email    = (credentials?.email    as string | undefined)?.trim().toLowerCase()
        const password = credentials?.password  as string | undefined

        if (!email || !password) return null

        const { rows } = await db.query<{
          id:            string
          email:         string
          name:          string | null
          image:         string | null
          password_hash: string | null
        }>(
          `SELECT id, email, name, image, password_hash
           FROM users
           WHERE email = $1
           LIMIT 1`,
          [email]
        )

        const user = rows[0]
        if (!user || !user.password_hash) return null  // OAuth-only or not found

        const ok = await verifyPassword(password, user.password_hash)
        if (!ok) return null

        return {
          id:    user.id,
          email: user.email,
          name:  user.name ?? undefined,
          image: user.image ?? undefined,
        }
      },
    }),
  ],

  session: {
    strategy: 'database',
  },

  callbacks: {
    async session({ session, user }) {
      // Attach user id, plan, and emailVerified to session for use in Server Components
      if (session.user) {
        const dbUser = user as {
          id:             string
          plan?:          string
          emailVerified?: Date | null
        }
        session.user.id            = dbUser.id
        session.user.plan          = dbUser.plan ?? 'free'
        session.user.emailVerified = dbUser.emailVerified ?? null
      }
      return session
    },
  },

  pages: {
    signIn: '/sign-in',
  },
})
