require('dotenv').config()
const OpenAI = require('openai')
const fs = require('fs')
const path = require('path')
const os = require('os')
const express = require('express')
const cors = require('cors')
const Anthropic = require('@anthropic-ai/sdk')
const { createClient } = require('@supabase/supabase-js')

const app = express()
app.use(cors())
app.use(express.json())

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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
// ── POST /api/trascrivi ────────────────────────────────────────────
app.post('/api/trascrivi', async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return

  let body = ''
  req.on('data', chunk => { body += chunk })
  req.on('end', async () => {
    try {
      const { audio, durata } = JSON.parse(body)
      if (!audio) return res.status(400).json({ error: 'Audio mancante' })

      // Converti base64 in file temporaneo
      const tmpPath = path.join(os.tmpdir(), `audio_${Date.now()}.m4a`)
      fs.writeFileSync(tmpPath, Buffer.from(audio, 'base64'))

      // Trascrivi con Whisper
      const trascrizione = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tmpPath),
        model: 'whisper-1',
        language: 'it',
        response_format: 'text'
      })

      fs.unlinkSync(tmpPath)

      // Salva in Supabase
      const { data, error } = await supabase
        .from('trascrizioni')
        .insert({
          user_id: user.id,
          testo: trascrizione,
          titolo: `Chiamata ${new Date().toLocaleDateString('it-IT')}`,
          durata_secondi: durata || 0,
        })
        .select()
        .single()

      if (error) return res.status(500).json({ error: error.message })
      res.json({ trascrizione, id: data.id })

    } catch (err) {
      console.error('Errore Whisper:', err)
      res.status(500).json({ error: err.message })
    }
  })
})

// ── GET /api/trascrizioni ──────────────────────────────────────────
app.get('/api/trascrizioni', async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return

  const { data, error } = await supabase
    .from('trascrizioni')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})
app.listen(PORT, () => {
  console.log(`✅ PreventivoAI backend attivo su porta ${PORT}`)
})