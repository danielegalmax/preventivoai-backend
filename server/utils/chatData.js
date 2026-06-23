const { supabase } = require('../config')

async function caricaProfiloChat(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('nome_azienda, citta, piva, telefono, listino, tono, categoria')
    .eq('id', userId)
    .single()

  return data
}

async function caricaServiziChat(userId) {
  const { data } = await supabase
    .from('servizi')
    .select('nome, descrizione, costo, unita')
    .eq('user_id', userId)
    .order('ordine', { ascending: true })

  return data
}

async function caricaClienteChat(clienteId, userId) {
  if (!clienteId) return null

  const { data } = await supabase
    .from('clienti')
    .select('nome, telefono, email, indirizzo, note')
    .eq('id', clienteId)
    .eq('user_id', userId)
    .single()

  return data
}

async function caricaProfiloConvertiRecap(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('nome_azienda, citta, piva, telefono')
    .eq('id', userId)
    .single()

  return data
}

module.exports = { caricaClienteChat, caricaProfiloChat, caricaProfiloConvertiRecap, caricaServiziChat }
