const express = require('express')
const { supabase } = require('../config')
const verificaUtente = require('../middleware/auth')
const { sendError } = require('../utils/http')
const { getStripeClient } = require('../utils/stripePayments')

const router = express.Router()
const webhookRouter = express.Router()

async function caricaStripeProfilo(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('stripe_account_id, stripe_onboarding_status, stripe_charges_enabled')
    .eq('id', userId)
    .single()

  if (error) throw error
  return data
}

router.post('/api/stripe/connetti-account', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return

  const stripe = getStripeClient()
  if (!stripe) return res.status(500).json({ error: 'Stripe non configurato' })

  try {
    const profilo = await caricaStripeProfilo(user.id)

    if (profilo.stripe_account_id) {
      return res.json({ stripe_account_id: profilo.stripe_account_id })
    }

    const account = await stripe.accounts.create({
      type: 'express',
      country: 'IT',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    })

    const { error } = await supabase
      .from('profiles')
      .update({ stripe_account_id: account.id })
      .eq('id', user.id)

    if (error) return res.status(500).json({ error: error.message })

    res.json({ stripe_account_id: account.id })
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/api/stripe/onboarding-link', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return

  const stripe = getStripeClient()
  if (!stripe) return res.status(500).json({ error: 'Stripe non configurato' })

  try {
    const { return_url, refresh_url } = req.body || {}
    if (!return_url || !refresh_url) {
      return res.status(400).json({ error: 'return_url e refresh_url sono obbligatori' })
    }

    console.log('[stripeConnect] onboarding-link return_url ricevuto:', return_url)
    console.log('[stripeConnect] onboarding-link refresh_url ricevuto:', refresh_url)

    const profilo = await caricaStripeProfilo(user.id)
    if (!profilo.stripe_account_id) {
      return res.status(400).json({ error: 'Account Stripe non collegato. Chiama prima /api/stripe/connetti-account.' })
    }

    const accountLink = await stripe.accountLinks.create({
      account: profilo.stripe_account_id,
      refresh_url,
      return_url,
      type: 'account_onboarding',
    })

    res.json({ url: accountLink.url })
  } catch (err) {
    console.log('[stripeConnect] Stripe accountLinks.create error.message:', err?.message)
    console.log('[stripeConnect] Stripe accountLinks.create error.raw:', err?.raw)
    sendError(res, err)
  }
})

router.get('/api/stripe/stato-account', async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return

  try {
    const profilo = await caricaStripeProfilo(user.id)
    res.json({
      stripe_onboarding_status: profilo.stripe_onboarding_status ?? 'non_connesso',
      stripe_charges_enabled: profilo.stripe_charges_enabled ?? false,
    })
  } catch (err) {
    sendError(res, err)
  }
})

webhookRouter.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe = getStripeClient()
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!stripe || !webhookSecret) {
    return res.status(500).json({ error: 'Stripe webhook non configurato' })
  }

  const signature = req.headers['stripe-signature']
  if (!signature) {
    return res.status(400).json({ error: 'Firma webhook mancante' })
  }

  let event
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret)
  } catch (err) {
    return res.status(400).json({ error: `Firma webhook non valida: ${err.message}` })
  }

  if (event.type === 'account.updated') {
    const account = event.data.object
    const chargesEnabled = account.charges_enabled === true

    await supabase
      .from('profiles')
      .update({
        stripe_charges_enabled: chargesEnabled,
        stripe_onboarding_status: chargesEnabled ? 'verificato' : 'in_attesa',
      })
      .eq('stripe_account_id', account.id)
  }

  res.json({ received: true })
})

module.exports = router
module.exports.webhookRouter = webhookRouter
