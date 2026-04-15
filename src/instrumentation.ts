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

    // Sync legitimate domains on every startup so MANUAL_SEED changes
    // take effect automatically after each deployment.
    try {
      const { syncLegitDomains } = await import('./lib/server/sync/legitimate-domains')
      const result = await syncLegitDomains()
      console.log(`[instrumentation] legit-domains synced: ${result.total} entries (${result.durationMs}ms)`)
    } catch (err) {
      console.error('[instrumentation] legit-domains sync failed:', err)
    }
  }
}
