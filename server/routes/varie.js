const express = require('express')
const fs = require('fs')
const router = express.Router()
const { supabase } = require('../config')
const verificaUtente = require('../middleware/auth')
const { asyncRoute, sendError } = require('../utils/http')

router.post('/api/salva-preventivo', asyncRoute(async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  const { testo_preventivo, importo_totale, nome_cliente, messaggio_cliente } = req.body
  const { data, error } = await supabase.from('preventivi').insert({
    user_id: user.id,
    testo_preventivo,
    importo_totale: importo_totale || null,
    nome_cliente: nome_cliente || null,
    messaggio_cliente: messaggio_cliente || null,
    stato: 'bozza'
  }).select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
}))

// ── POST /api/trascrivi ────────────────────────────────────────────
router.post('/api/trascrivi', express.json({ limit: '50mb' }), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  try {
    const { audio, durata } = req.body
    if (!audio) return res.status(400).json({ error: 'Audio mancante' })
    const buffer = Buffer.from(audio, 'base64')
    const tempPath = `/tmp/audio_${Date.now()}.m4a`
    fs.writeFileSync(tempPath, buffer)
    const { default: OpenAI } = require('openai')
    const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const trascrizione = await openaiClient.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: 'whisper-1',
      language: 'it'
    })
    fs.unlinkSync(tempPath)
    res.json({ trascrizione: trascrizione.text })
  } catch (err) {
    console.error('Errore trascrizione:', err)
    sendError(res, err)
  }
})

// ── GET /api/trascrizioni ──────────────────────────────────────────
router.get('/api/trascrizioni', asyncRoute(async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  const { data, error } = await supabase.from('trascrizioni').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
}))

// ── POST /api/upload-logo ──────────────────────────────────────────

module.exports = router
