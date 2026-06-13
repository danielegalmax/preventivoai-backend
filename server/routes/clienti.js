const express = require('express')
const router = express.Router()
const { supabase } = require('../config')
const verificaUtente = require('../middleware/auth')

router.post('/api/cerca-cliente', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  try {
    const { nome } = req.body
    if (!nome) return res.json({ risultati: [] })
    const { data } = await supabase
      .from('clienti')
      .select('id, nome, telefono, email, indirizzo, note')
      .eq('user_id', user.id)
      .ilike('nome', `%${nome}%`)
      .limit(5)
    res.json({ risultati: data || [] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/crea-cliente-da-chat ────────────────────────────────
router.post('/api/crea-cliente-da-chat', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  try {
    const { nome, telefono, email, indirizzo } = req.body
    const { data, error } = await supabase
      .from('clienti')
      .insert({ user_id: user.id, nome, telefono: telefono || null, email: email || null, indirizzo: indirizzo || null })
      .select().single()
    if (error) return res.status(500).json({ error: error.message })
    res.json({ cliente: data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/salva-preventivo ────────────────────────────────────

module.exports = router
