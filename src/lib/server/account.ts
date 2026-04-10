import { db } from './db'

export async function getBillingCustomerId(userId: string): Promise<string | null> {
  const { rows } = await db.query<{ stripe_customer_id: string | null }>(
    'SELECT stripe_customer_id FROM users WHERE id = $1 LIMIT 1',
    [userId]
  )

  return rows[0]?.stripe_customer_id ?? null
}
