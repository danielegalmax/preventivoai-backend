const express = require('express')
const router = express.Router()
const verificaUtente = require('../middleware/auth')
const { asyncRoute, sendError } = require('../utils/http')
const { trascriviAudioBase64 } = require('../utils/audioTranscription')
const { caricaTrascrizioni, salvaPreventivoBozza } = require('../utils/varieData')

router.post('/api/salva-preventivo', asyncRoute(async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  const { data, error } = await salvaPreventivoBozza(user.id, req.body)
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
}))

// ── POST /api/trascrivi ────────────────────────────────────────────
router.post('/api/trascrivi', express.json({ limit: '50mb' }), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  try {
    const { audio } = req.body
    if (!audio) return res.status(400).json({ error: 'Audio mancante' })
    const trascrizione = await trascriviAudioBase64(audio)
    res.json({ trascrizione })
  } catch (err) {
    console.error('Errore trascrizione:', err)
    sendError(res, err)
  }
})

// ── GET /api/trascrizioni ──────────────────────────────────────────
router.get('/api/trascrizioni', asyncRoute(async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  const { data, error } = await caricaTrascrizioni(user.id)
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
}))

// ── POST /api/upload-logo ──────────────────────────────────────────

router.get('/api/versione-minima', (req, res) => {
  res.json({
    android: process.env.VERSION_MINIMA_ANDROID ?? '1.0.0',
    desktop: process.env.VERSION_MINIMA_DESKTOP ?? '1.0.0',
    ios: process.env.VERSION_MINIMA_IOS ?? '1.0.0',
  })
})

module.exports = router
