import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import PostgresAdapter from '@auth/pg-adapter'
import { db } from '@/lib/server/db'

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  adapter: PostgresAdapter(db),

  providers: [
    Google({
      clientId:     process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  session: {
    strategy: 'database',
  },

  callbacks: {
    async session({ session, user }) {
      // Attach user id and plan to session for use in Server Components
      if (session.user) {
        session.user.id   = user.id
        session.user.plan = (user as { plan?: string }).plan ?? 'free'
      }
      return session
    },
  },

  pages: {
    signIn: '/sign-in',
  },
})
