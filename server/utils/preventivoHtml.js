const { supabase } = require('../config')
const { generaHTML } = require('./templates')

async function generaHtmlPreventivo(req, user) {
  const { testo, template, versione_padre_id, cliente_id, nascondi_prezzi, demo_profile, demo_cliente } = req.body
  const { data: profile } = await supabase.from('profiles').select('nome_azienda, citta, piva, telefono, logo_url, colore_brand, template_preferito, note_pagamento, firma_nome, contatore_preventivi').eq('id', user.id).single()
  const colore = profile?.colore_brand || '0D1B2A'
  const logo = profile?.logo_url || null
  const nome = demo_profile?.nome_azienda || profile?.nome_azienda || 'Azienda'
  const citta = demo_profile?.citta || profile?.citta || ''
  const piva = demo_profile?.piva || profile?.piva || ''
  const telefono = demo_profile?.telefono || profile?.telefono || ''
  const tmpl = template || profile?.template_preferito || 'pulito'
  const notePagamento = profile?.note_pagamento || ''
  const firmaNome = demo_profile?.firma_nome || profile?.firma_nome || ''

  console.log('cliente_id ricevuto:', cliente_id)
  let clienteDati = null
  if (demo_cliente) {
    clienteDati = demo_cliente
  } else if (cliente_id) {
    const { data: cl } = await supabase.from('clienti')
      .select('nome, telefono, email, indirizzo')
      .eq('id', cliente_id).single()
    if (cl) clienteDati = cl
  }

  const nuovoContatore = (profile?.contatore_preventivi || 0) + 1
  await supabase.from('profiles').update({ contatore_preventivi: nuovoContatore }).eq('id', user.id)
  const anno = new Date().getFullYear()
  const numeroPreventivo = `PRV-${anno}-${String(nuovoContatore).padStart(4, '0')}`

  const html = generaHTML(testo, tmpl, { nome, citta, piva, telefono, logo, colore, notePagamento, firmaNome, numeroPreventivo, clienteDati, nascondiPrezzi: !!nascondi_prezzi })
  if (versione_padre_id) {
    await supabase.from('preventivi').update({ is_ultimo: false }).eq('id', versione_padre_id)
  }
  let versione = 1
  if (versione_padre_id) {
    const { data: padre } = await supabase.from('preventivi').select('versione').eq('id', versione_padre_id).single()
    if (padre) versione = (padre.versione || 1) + 1
  }

  return { html, versione, numeroPreventivo }
}

module.exports = { generaHtmlPreventivo }
