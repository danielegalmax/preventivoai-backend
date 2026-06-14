const express = require('express')
const router = express.Router()
const { supabase } = require('../config')
const verificaUtente = require('../middleware/auth')
const { generaHTML } = require('../utils/templates')
const Stripe = require('stripe')
const puppeteer = require('puppeteer')

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null

// Funzione interna per preparare i dati e l'HTML
async function preparePdfData(req, user) {
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

  const html = generaHTML(testo, tmpl, { 
    nome, citta, piva, telefono, logo, colore, 
    notePagamento, firmaNome, numeroPreventivo, 
    clienteDati, nascondiPrezzi: !!nascondi_prezzi 
  })

  let versione = 1
  if (versione_padre_id) {
    const { data: padre } = await supabase.from('preventivi').select('versione').eq('id', versione_padre_id).single()
    if (padre) versione = (padre.versione || 1) + 1
  }

  return { html, versione, numeroPreventivo }
}

// NUOVO ENDPOINT: Genera e salva direttamente su Supabase
router.post('/api/genera-salva-pdf', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return

  let browser
  try {
    // 1. Preparo HTML e dati
    const { html, versione, numeroPreventivo } = await preparePdfData(req, user)

    // 2. Lancio Puppeteer per creare il PDF
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
    await browser.close()

    // 3. Carico il buffer direttamente su Supabase Storage
    const fileName = `${user.id}/${Date.now()}.pdf`
    const { error: uploadError } = await supabase.storage
      .from('preventivi-pdf')
      .upload(fileName, pdfBuffer, { 
        contentType: 'application/pdf', 
        upsert: false 
      })

    if (uploadError) throw new Error("Errore upload: " + uploadError.message)

    // 4. Prendo l'URL pubblico
    const { data: urlData } = supabase.storage.from('preventivi-pdf').getPublicUrl(fileName)

    // 5. Rispondo al mobile col link pronto
    res.json({ 
      pdf_url: urlData.publicUrl, 
      versione, 
      numeroPreventivo, 
      html 
    })

  } catch (err) {
    if (browser) await browser.close()
    console.error("Errore generazione/salvataggio PDF:", err)
    res.status(500).json({ error: err.message })
  }
})

// Manteniamo gli altri per compatibilità temporanea
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
    res.status(500).json({ error: err.message })
  }
})

module.exports = router