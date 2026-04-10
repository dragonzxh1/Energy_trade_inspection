/**
 * POST /api/stripe/webhook
 *
 * Handles Stripe webhook events:
 * - `checkout.session.completed`: activate the subscription and set the plan
 * - `customer.subscription.updated`: handle plan changes and renewals
 * - `customer.subscription.deleted`: downgrade the user to free
 */

import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { db } from '@/lib/server/db'
import type Stripe from 'stripe'

export async function POST(req: NextRequest) {
  const body      = await req.text()
  const signature = req.headers.get('stripe-signature') ?? ''
  const secret    = process.env.STRIPE_WEBHOOK_SECRET ?? ''

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, secret)
  } catch {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        await handleCheckoutComplete(session)
        break
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        await handleSubscriptionUpdate(sub)
        break
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        await handleSubscriptionDeleted(sub)
        break
      }
    }
  } catch (err) {
    console.error('[stripe webhook] handler error:', err)
    return NextResponse.json({ error: 'Handler failed.' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId
  const plan   = session.metadata?.plan

  if (!userId || !plan) return

  await db.query(
    `UPDATE users
     SET plan = $1,
         stripe_customer_id = $2,
         stripe_subscription_id = $3
     WHERE id = $4`,
    [plan, session.customer as string, session.subscription as string, userId]
  )
}

async function handleSubscriptionUpdate(sub: Stripe.Subscription) {
  const userId = sub.metadata?.userId
  if (!userId) return

  // Determine plan from price ID
  const priceId = sub.items.data[0]?.price?.id ?? ''
  const plan = resolvePlanFromPrice(priceId)

  if (sub.status === 'active' || sub.status === 'trialing') {
    await db.query(
      'UPDATE users SET plan = $1, stripe_subscription_id = $2 WHERE id = $3',
      [plan, sub.id, userId]
    )
  }
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  const userId = sub.metadata?.userId
  if (!userId) return

  await db.query(
    `UPDATE users
     SET plan = 'free', stripe_subscription_id = NULL
     WHERE id = $1`,
    [userId]
  )
}

function resolvePlanFromPrice(priceId: string): string {
  if (priceId === process.env.STRIPE_PRICE_STARTER)      return 'starter'
  if (priceId === process.env.STRIPE_PRICE_PROFESSIONAL) return 'professional'
  return 'free'
}

