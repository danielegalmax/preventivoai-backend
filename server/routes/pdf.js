const express = require('express')
const router = express.Router()
const { supabase } = require('../config')
const verificaUtente = require('../middleware/auth')
const { generaHTML } = require('../utils/templates')

router.post('/api/genera-pdf', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  try {
    const { testo, template, versione_padre_id, cliente_id } = req.body
    const { data: profile } = await supabase.from('profiles').select('nome_azienda, citta, piva, telefono, logo_url, colore_brand, template_preferito, note_pagamento, firma_nome, contatore_preventivi').eq('id', user.id).single()
    const colore = profile?.colore_brand || '0D1B2A'
    const logo = profile?.logo_url || null
    const nome = profile?.nome_azienda || 'Azienda'
    const citta = profile?.citta || ''
    const piva = profile?.piva || ''
    const telefono = profile?.telefono || ''
    const tmpl = template || profile?.template_preferito || 'pulito'
    const notePagamento = profile?.note_pagamento || ''
    const firmaNome = profile?.firma_nome || ''

    // Carica dati cliente se presente
    console.log('cliente_id ricevuto:', cliente_id)
    let clienteDati = null
    if (cliente_id) {
      const { data: cl } = await supabase.from('clienti')
        .select('nome, telefono, email, indirizzo')
        .eq('id', cliente_id).single()
      if (cl) clienteDati = cl
    }

    // Incrementa contatore preventivi
    const nuovoContatore = (profile?.contatore_preventivi || 0) + 1
    await supabase.from('profiles').update({ contatore_preventivi: nuovoContatore }).eq('id', user.id)
    const anno = new Date().getFullYear()
    const numeroPreventivo = `PRV-${anno}-${String(nuovoContatore).padStart(4, '0')}`

    const html = generaHTML(testo, tmpl, { nome, citta, piva, telefono, logo, colore, notePagamento, firmaNome, numeroPreventivo, clienteDati })
    if (versione_padre_id) {
      await supabase.from('preventivi').update({ is_ultimo: false }).eq('id', versione_padre_id)
    }
    let versione = 1
    if (versione_padre_id) {
      const { data: padre } = await supabase.from('preventivi').select('versione').eq('id', versione_padre_id).single()
      if (padre) versione = (padre.versione || 1) + 1
    }
    res.json({ html, versione, numeroPreventivo })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/salva-pdf ────────────────────────────────────────────
router.post('/api/salva-pdf', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  try {
    const { pdf_base64 } = req.body
    if (!pdf_base64) return res.status(400).json({ error: 'PDF mancante' })
    const pdfBuffer = Buffer.from(pdf_base64, 'base64')
    const fileName = `${user.id}/${Date.now()}.pdf`
    const { error } = await supabase.storage.from('preventivi-pdf').upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: false })
    if (error) return res.status(500).json({ error: error.message })
    const { data: urlData } = supabase.storage.from('preventivi-pdf').getPublicUrl(fileName)
    res.json({ pdf_url: urlData.publicUrl })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/elabora-servizi ──────────────────────────────────────

module.exports = router
