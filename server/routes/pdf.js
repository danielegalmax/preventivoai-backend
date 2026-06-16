const express = require('express')
const router = express.Router()
const { supabase } = require('../config')
const verificaUtente = require('../middleware/auth')
const { generaHTML } = require('../utils/templates')
const { sendError } = require('../utils/http')
const Stripe = require('stripe')
const puppeteer = require('puppeteer')

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null

async function generaHtmlPreventivo(req, res, user) {
  const { testo, template, versione_padre_id, cliente_id, nascondi_prezzi } = req.body
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

  console.log('cliente_id ricevuto:', cliente_id)
  let clienteDati = null
  if (cliente_id) {
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

router.post('/api/genera-pdf', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  try {
    const { html, versione, numeroPreventivo } = await generaHtmlPreventivo(req, res, user)
    res.json({ html, versione, numeroPreventivo })
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/api/genera-pdf-file', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  let browser
  try {
    const { html, versione, numeroPreventivo } = await generaHtmlPreventivo(req, res, user)
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true
    })
    res.json({ pdf_base64: Buffer.from(pdfBuffer).toString('base64'), versione, numeroPreventivo, html })
  } catch (err) {
    sendError(res, err)
  } finally {
    if (browser) await browser.close()
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
    sendError(res, err)
  }
})

// ── POST /api/crea-link-pagamento ──────────────────────────────────────

router.post('/api/crea-link-pagamento', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  if (!stripe) return res.status(500).json({ error: 'Stripe non configurato' })

  try {
    const { importo, descrizione } = req.body
    const amount = Math.round(Number(importo) * 100)
    if (!amount || amount < 50) return res.status(400).json({ error: 'Importo non valido' })

    const session = await stripe.checkout.sessions.create({
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
      metadata: { user_id: user.id }
    })

    res.json({ payment_url: session.url })
  } catch (err) {
    sendError(res, err)
  }
})
// ── POST /api/crea-link-pagamento-rata ────────────────────────────
router.post('/api/crea-link-pagamento-rata', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  if (!stripe) return res.status(500).json({ error: 'Stripe non configurato' })

  try {
    const { rata_id, cliente_nome } = req.body
    if (!rata_id) return res.status(400).json({ error: 'rata_id mancante' })

    // Carica rata e abbonamento
    const { data: rata } = await supabase
      .from('rate_abbonamento')
      .select('*, abbonamenti(user_id, importo_default)')
      .eq('id', rata_id)
      .single()

    if (!rata) return res.status(404).json({ error: 'Rata non trovata' })
    if (rata.abbonamenti.user_id !== user.id) return res.status(403).json({ error: 'Non autorizzato' })

    const residuo = rata.importo - (rata.acconto || 0)
    if (residuo <= 0) return res.status(400).json({ error: 'Rata già saldata' })

    const MESI = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre']
    const descrizione = `Canone ${MESI[rata.mese - 1]} ${rata.anno}${cliente_nome ? ` — ${cliente_nome}` : ''}`

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: Math.round(residuo * 100),
          product_data: { name: descrizione }
        }
      }],
      success_url: 'https://preventivoai-web.vercel.app/pagamento-ok',
      cancel_url: 'https://preventivoai-web.vercel.app/pagamento-annullato',
      metadata: { user_id: user.id, rata_id, tipo: 'abbonamento' }
    })

    res.json({ payment_url: session.url })
  } catch (err) {
    sendError(res, err)
  }
})

module.exports = router
