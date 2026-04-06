// Next.js instrumentation hook —服务器启动时自动运行迁移
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { applyMigrations } = await import('./lib/server/migrations')
      await applyMigrations()
    } catch (err) {
      // 迁移失败不阻断服务器启动（各页面的 applyMigrations() 调用会再次重试）
      console.error('[instrumentation] 迁移失败，将在首次请求时重试:', err)
    }
  }
}
