const express = require('express')
const router = express.Router()
const verificaUtente = require('../middleware/auth')
const { sendError } = require('../utils/http')
const { supabase } = require('../config')
const { generaHtmlPreventivo } = require('../utils/preventivoHtml')
const { salvaPdfSuStorage } = require('../utils/pdfStorage')
const { generaPdfBufferDaHtml } = require('../utils/pdfRenderer')
const { caricaRataAbbonamento, creaSessionePagamento, getStripeClient } = require('../utils/stripePayments')
const { trackEvento } = require('../utils/analytics')
const {
  SIGNED_URL_EXPIRY_ARTIGIANO_SEC,
  signedUrlArtigianoPdfReference,
} = require('../utils/pdfSignedUrls')

const stripe = getStripeClient()

router.post('/api/genera-pdf', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  try {
    const { html, versione, numeroPreventivo, numeroProvvisorio } = await generaHtmlPreventivo(req, user, { assegnaNumero: false })
    res.json({ html, versione, numeroPreventivo, numeroProvvisorio })
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/api/genera-pdf-file', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  try {
    const { html, versione, numeroPreventivo } = await generaHtmlPreventivo(req, user, { assegnaNumero: true })
    const pdfBuffer = await generaPdfBufferDaHtml(html)
    trackEvento({ userId: user.id, evento: 'pdf_generato', schermata: 'preventivo-pdf', dati: { template: req.body.template, versione } })
    res.json({ pdf_base64: Buffer.from(pdfBuffer).toString('base64'), versione, numeroPreventivo, numeroProvvisorio: false, html })
  } catch (err) {
    sendError(res, err)
  }
})

// ── POST /api/salva-pdf ────────────────────────────────────────────
router.post('/api/salva-pdf', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  try {
    const { pdf_base64 } = req.body
    if (!pdf_base64) return res.status(400).json({ error: 'PDF mancante' })
    const { pdfUrl, storagePath, error } = await salvaPdfSuStorage(user.id, pdf_base64)
    if (error) return res.status(500).json({ error: error.message })
    res.json({
      pdf_url: pdfUrl,
      storage_path: storagePath,
      expires_in: SIGNED_URL_EXPIRY_ARTIGIANO_SEC,
    })
  } catch (err) {
    sendError(res, err)
  }
})

router.get('/api/preventivi/:id/pdf-url', async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return

  try {
    const { data: preventivo, error } = await supabase
      .from('preventivi')
      .select('pdf_url, user_id')
      .eq('id', req.params.id)
      .single()

    if (error || !preventivo || preventivo.user_id !== user.id) {
      return res.status(404).json({ error: 'Preventivo non trovato' })
    }
    if (!preventivo.pdf_url) {
      return res.status(404).json({ error: 'PDF non disponibile' })
    }

    const pdfUrl = await signedUrlArtigianoPdfReference(preventivo.pdf_url)
    if (!pdfUrl) {
      return res.status(400).json({ error: 'Riferimento PDF non valido' })
    }

    res.json({
      pdf_url: pdfUrl,
      expires_in: SIGNED_URL_EXPIRY_ARTIGIANO_SEC,
    })
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

    const session = await creaSessionePagamento({ amount, descrizione, metadata: { user_id: user.id } })

    trackEvento({ userId: user.id, evento: 'stripe_link_creato', schermata: 'preventivo-pdf', dati: { importo } })
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
    const rata = await caricaRataAbbonamento(rata_id)

    if (!rata) return res.status(404).json({ error: 'Rata non trovata' })
    if (rata.abbonamenti.user_id !== user.id) return res.status(403).json({ error: 'Non autorizzato' })

    const residuo = rata.importo - (rata.acconto || 0)
    if (residuo <= 0) return res.status(400).json({ error: 'Rata già saldata' })

    const MESI = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre']
    const descrizione = `Canone ${MESI[rata.mese - 1]} ${rata.anno}${cliente_nome ? ` — ${cliente_nome}` : ''}`

    const session = await creaSessionePagamento({
      amount: Math.round(residuo * 100),
      descrizione,
      metadata: { user_id: user.id, rata_id, tipo: 'abbonamento' }
    })

    res.json({ payment_url: session.url })
  } catch (err) {
    sendError(res, err)
  }
})

module.exports = router
