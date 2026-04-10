// Next.js instrumentation hook. Run migrations during Node.js startup.
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { applyMigrations } = await import('./lib/server/migrations')
      await applyMigrations()
    } catch (err) {
      // Keep the server booting, but surface the migration failure clearly.
      console.error('[instrumentation] migration startup failed:', err)
    }
  }
}
