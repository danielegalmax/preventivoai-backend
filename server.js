require('dotenv').config()
const express = require('express')
const cors = require('cors')
const Anthropic = require('@anthropic-ai/sdk')
const { createClient } = require('@supabase/supabase-js')

const app = express()
app.use(cors())
app.use(express.json())

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// ── Verifica JWT Supabase ─────────────────────────────────────────
async function verificaUtente(req, res) {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Non autorizzato' })
    return null
  }
  const token = auth.replace('Bearer ', '')
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) {
    res.status(401).json({ error: 'Token non valido' })
    return null
  }
  return user
}

// ── GET /api/profilo ──────────────────────────────────────────────
app.get('/api/profilo', async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ── POST /api/chat ────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return

  const { messages } = req.body
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages mancanti' })
  }

  // Carica profilo artigiano dal DB
  const { data: profile } = await supabase
    .from('profiles')
    .select('nome_azienda, categoria, citta, listino, tono')
    .eq('id', user.id)
    .single()

  if (!profile) return res.status(404).json({ error: 'Profilo non trovato' })

  const system = `Sei l'assistente commerciale di ${profile.nome_azienda || 'questa azienda'}, ${profile.categoria || 'artigiano'} a ${profile.citta || 'Italia'}.

LISTINO PREZZI:
${profile.listino || 'Listino non ancora configurato'}

TONO: ${profile.tono || 'professionale e diretto'}

ISTRUZIONI:
- Se mancano dati essenziali per il preventivo, fai UNA sola domanda — la più importante.
- Quando hai abbastanza informazioni scrivi esattamente PREVENTIVO_PRONTO su una riga, poi il preventivo.
- Formato preventivo:

---
PREVENTIVO — ${profile.nome_azienda || 'Azienda'}
Data: ${new Date().toLocaleDateString('it-IT')}  |  Validità: 30 giorni

Problema: [descrizione breve]

VOCI:
- [descrizione]: €XX
- [descrizione]: €XX

Imponibile: €XX
IVA 22%: €XX
─────────────────
TOTALE: €XX

Note: [breve nota utile]
Contatti: ${profile.nome_azienda || 'Azienda'} · ${profile.citta || 'Italia'}
---

- Usa sempre il listino fornito. Non inventare prezzi.
- Tono: ${profile.tono || 'professionale e diretto'}.`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system,
      messages
    })

    const reply = response.content[0].text
    res.json({ reply })

  } catch (err) {
    console.error('Errore Claude:', err)
    res.status(500).json({ error: 'Errore AI: ' + err.message })
  }
})

// ── POST /api/salva-preventivo ────────────────────────────────────
app.post('/api/salva-preventivo', async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return

  const { testo_preventivo, importo_totale, nome_cliente, messaggio_cliente } = req.body

  const { data, error } = await supabase
    .from('preventivi')
    .insert({
      user_id: user.id,
      testo_preventivo,
      importo_totale: importo_totale || null,
      nome_cliente: nome_cliente || null,
      messaggio_cliente: messaggio_cliente || null,
      stato: 'bozza'
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ── Health check ──────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`✅ PreventivoAI backend attivo su porta ${PORT}`)
})