const express = require('express')
const router = express.Router()
const { anthropic, supabase } = require('../config')
const verificaUtente = require('../middleware/auth')

router.get('/api/profilo', async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ── POST /api/chat ────────────────────────────────────────────────

router.post('/api/upload-logo', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  try {
    const { logo_base64, mime_type } = req.body
    const { data, error } = await supabase.storage.from('loghi').upload(`${user.id}/logo`, Buffer.from(logo_base64, 'base64'), { contentType: mime_type || 'image/png', upsert: true })
    if (error) return res.status(500).json({ error: error.message })
    const { data: urlData } = supabase.storage.from('loghi').getPublicUrl(`${user.id}/logo`)
    await supabase.from('profiles').update({ logo_url: urlData.publicUrl }).eq('id', user.id)
    res.json({ logo_url: urlData.publicUrl })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/genera-pdf ───────────────────────────────────────────

router.post('/api/elabora-servizi', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  try {
    const { testo } = req.body
    if (!testo) return res.status(400).json({ error: 'Testo mancante' })
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: `Analizza questo listino prezzi e restituisci un array JSON di servizi strutturati.\n\nListino:\n${testo}\n\nRispondi SOLO con un array JSON valido, niente altro. Formato:\n[\n  {\n    "nome": "Nome servizio",\n    "descrizione": "Breve descrizione opzionale",\n    "costo": 300,\n    "unita": "cad"\n  }\n]\n\nPer unita usa: cad, ora, giorno, mq, ml, set, progetto\nSe il costo non è specificato, metti null.\nSe la descrizione non è chiara, metti stringa vuota.` }]
    })
    const clean = response.content[0].text.trim().replace(/```json|```/g, '').trim()
    res.json({ servizi: JSON.parse(clean) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Parser testo preventivo ────────────────────────────────────────

module.exports = router
