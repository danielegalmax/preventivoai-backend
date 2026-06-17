const express = require('express')
const router = express.Router()
const verificaUtente = require('../middleware/auth')
const { sendError } = require('../utils/http')
const { generaHtmlPreventivo } = require('../utils/preventivoHtml')
const { salvaPdfSuStorage } = require('../utils/pdfStorage')
const { generaPdfBufferDaHtml } = require('../utils/pdfRenderer')
const { caricaRataAbbonamento, creaSessionePagamento, getStripeClient } = require('../utils/stripePayments')
const { trackEvento } = require('../utils/analytics')

const stripe = getStripeClient()

router.post('/api/genera-pdf', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  try {
    const { html, versione, numeroPreventivo } = await generaHtmlPreventivo(req, user)
    res.json({ html, versione, numeroPreventivo })
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/api/genera-pdf-file', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  try {
    const { html, versione, numeroPreventivo } = await generaHtmlPreventivo(req, user)
    const pdfBuffer = await generaPdfBufferDaHtml(html)
    trackEvento({ userId: user.id, evento: 'pdf_generato', schermata: 'preventivo-pdf', dati: { template: req.body.template, versione } })
    res.json({ pdf_base64: Buffer.from(pdfBuffer).toString('base64'), versione, numeroPreventivo, html })
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
    const { pdfUrl, error } = await salvaPdfSuStorage(user.id, pdf_base64)
    if (error) return res.status(500).json({ error: error.message })
    res.json({ pdf_url: pdfUrl })
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
