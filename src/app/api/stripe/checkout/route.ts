/**
 * POST /api/stripe/checkout
 * Body: { plan: 'starter' | 'professional' }
 *
 * Creates a Stripe Checkout Session and returns the URL.
 * Requires authentication; guests receive HTTP 401.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { stripe, PLAN_PRICES, PLAN_NAMES } from '@/lib/stripe'
import { db } from '@/lib/server/db'

export async function POST(req: NextRequest) {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const plan = body.plan as string

  if (!['starter', 'professional'].includes(plan)) {
    return NextResponse.json({ error: 'Invalid plan.' }, { status: 400 })
  }

  const priceId = PLAN_PRICES[plan]
  if (!priceId || priceId.startsWith('price_placeholder')) {
    return NextResponse.json(
      { error: 'Payment not yet configured. Please check back soon.' },
      { status: 503 }
    )
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3004'

  // Retrieve or create Stripe customer
  const { rows } = await db.query<{ stripe_customer_id: string | null }>(
    'SELECT stripe_customer_id FROM users WHERE id = $1',
    [session.user.id]
  )
  let customerId = rows[0]?.stripe_customer_id ?? null

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: session.user.email ?? undefined,
      name:  session.user.name  ?? undefined,
      metadata: { userId: session.user.id },
    })
    customerId = customer.id
    await db.query(
      'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
      [customerId, session.user.id]
    )
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    customer:   customerId,
    mode:       'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/upgrade/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${appUrl}/pricing`,
    metadata: {
      userId: session.user.id,
      plan,
    },
    subscription_data: {
      metadata: { userId: session.user.id, plan },
    },
    allow_promotion_codes: true,
  })

  return NextResponse.json({ url: checkoutSession.url })
}

