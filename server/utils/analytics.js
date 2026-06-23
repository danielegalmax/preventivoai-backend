const { supabase } = require('../config')

// Prezzi Claude Sonnet 4.6 ($ per milione di token)
const PREZZO_INPUT_PER_MILIONE = 3.0
const PREZZO_OUTPUT_PER_MILIONE = 15.0
const CAMBIO_EUR_USD = 0.92

function calcolaCosto(tokenInput, tokenOutput) {
  const costoUsd = (tokenInput / 1_000_000) * PREZZO_INPUT_PER_MILIONE +
                   (tokenOutput / 1_000_000) * PREZZO_OUTPUT_PER_MILIONE
  return costoUsd * CAMBIO_EUR_USD
}

async function trackAI({ userId, endpoint, modello = 'claude-sonnet-4-6', tokenInput = 0, tokenOutput = 0, latenzaMs = 0, errore = null }) {
  try {
    const costo = calcolaCosto(tokenInput, tokenOutput)
    await supabase.from('ai_usage').insert({
      user_id: userId,
      endpoint,
      modello,
      token_input: tokenInput,
      token_output: tokenOutput,
      costo_euro: costo,
      latenza_ms: latenzaMs,
      errore
    })
  } catch (e) {
    console.error('Analytics AI error:', e.message)
  }
}

async function trackEvento({ userId, evento, schermata = null, dati = null }) {
  try {
    await supabase.from('eventi').insert({
      user_id: userId,
      evento,
      schermata,
      dati
    })
  } catch (e) {
    console.error('Analytics evento error:', e.message)
  }
}

// unused
// TODO: collegare a POST /api/track sessioni
async function trackSessione(userId) {
  try {
    const { data } = await supabase
      .from('sessioni')
      .select('id, numero_sessioni')
      .eq('user_id', userId)
      .single()

    if (data) {
      await supabase.from('sessioni')
        .update({ ultimo_accesso: new Date().toISOString(), numero_sessioni: data.numero_sessioni + 1 })
        .eq('user_id', userId)
    } else {
      await supabase.from('sessioni').insert({ user_id: userId })
    }
  } catch (e) {
    console.error('Analytics sessione error:', e.message)
  }
}

module.exports = { trackAI, trackEvento, trackSessione }