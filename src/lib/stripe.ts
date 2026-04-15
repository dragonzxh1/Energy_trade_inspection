import Stripe from 'stripe'

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is required')
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-03-31.basil',
})

export const PLAN_PRICES: Record<string, string> = {
  starter:      process.env.STRIPE_PRICE_STARTER      ?? '',
  professional: process.env.STRIPE_PRICE_PROFESSIONAL ?? '',
}

export const PLAN_NAMES: Record<string, string> = {
  starter:      'Starter',
  professional: 'Professional',
}
