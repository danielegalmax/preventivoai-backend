const { supabase } = require('../config')

async function salvaPreventivoBozza(userId, payload) {
  const { testo_preventivo, importo_totale, nome_cliente, messaggio_cliente } = payload
  return supabase.from('preventivi').insert({
    user_id: userId,
    testo_preventivo,
    importo_totale: importo_totale || null,
    nome_cliente: nome_cliente || null,
    messaggio_cliente: messaggio_cliente || null,
    stato: 'bozza'
  }).select().single()
}

async function caricaTrascrizioni(userId) {
  return supabase
    .from('trascrizioni')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
}

module.exports = { caricaTrascrizioni, salvaPreventivoBozza }
