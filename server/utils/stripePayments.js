const Stripe = require('stripe')
const { supabase } = require('../config')

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null

function getStripeClient() {
  return stripe
}

async function creaSessionePagamento({ amount, descrizione, metadata }) {
  return stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: amount,
        product_data: { name: descrizione || 'Preventivo' }
      }
    }],
    success_url: 'https://preventivoai-web.vercel.app/pagamento-ok',
    cancel_url: 'https://preventivoai-web.vercel.app/pagamento-annullato',
    metadata
  })
}

async function caricaRataAbbonamento(rataId) {
  const { data: rata } = await supabase
    .from('rate_abbonamento')
    .select('*, abbonamenti(user_id, importo_default)')
    .eq('id', rataId)
    .single()

  return rata
}

module.exports = { caricaRataAbbonamento, creaSessionePagamento, getStripeClient }
