/**
 * Normalize an email address for abuse-detection purposes.
 * The normalized form is stored alongside the real email and used
 * to enforce uniqueness, blocking plus-addressing and Gmail dot tricks.
 *
 * NOT used for display or communication — always store/send the original email.
 */
export function normalizeEmail(email: string): string {
  const lower = email.toLowerCase().trim()
  const atIdx = lower.lastIndexOf('@')
  if (atIdx < 1) return lower

  const local  = lower.slice(0, atIdx)
  const domain = lower.slice(atIdx + 1)

  // Strip plus addressing for all providers (user+alias@example.com → user@example.com)
  const withoutAlias = local.split('+')[0]

  // Strip dots from local part for Gmail only (g.mail == gmail trick)
  const normalized =
    domain === 'gmail.com' || domain === 'googlemail.com'
      ? withoutAlias.replace(/\./g, '')
      : withoutAlias

  return `${normalized}@${domain}`
}
