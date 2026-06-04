require('dotenv').config()
const OpenAI = require('openai')
const fs = require('fs')
const path = require('path')
const os = require('os')
const express = require('express')
const cors = require('cors')
const Anthropic = require('@anthropic-ai/sdk')
const { createClient } = require('@supabase/supabase-js')
const { Readable } = require('stream')

const app = express()
app.use(cors())
app.use(express.json())

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const openai = process.env.OPENAI_API_KEY 
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null
const multer = require('multer')
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

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
// ── POST /api/upload-logo ──────────────────────────────────────────
app.post('/api/upload-logo', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return

  try {
    const { logo_base64, mime_type } = req.body
      
      const { data, error } = await supabase.storage
        .from('loghi')
        .upload(`${user.id}/logo`, Buffer.from(logo_base64, 'base64'), {
          contentType: mime_type || 'image/png',
          upsert: true
        })

      if (error) return res.status(500).json({ error: error.message })

      const { data: urlData } = supabase.storage.from('loghi').getPublicUrl(`${user.id}/logo`)
      
      await supabase.from('profiles').update({ logo_url: urlData.publicUrl }).eq('id', user.id)
      
      res.json({ logo_url: urlData.publicUrl })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

// ── POST /api/genera-pdf ───────────────────────────────────────────
app.post('/api/genera-pdf', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return

  try {
    const { preventivo_id, testo, template, versione_padre_id } = req.body

    const { data: profile } = await supabase
      .from('profiles')
      .select('nome_azienda, citta, piva, telefono, logo_url, colore_brand, template_preferito')
      .eq('id', user.id)
      .single()

    const colore = profile?.colore_brand || '0D1B2A'
    const logo = profile?.logo_url || null
    const nome = profile?.nome_azienda || 'Azienda'
    const citta = profile?.citta || ''
    const piva = profile?.piva || ''
    const telefono = profile?.telefono || ''
    const tmpl = template || profile?.template_preferito || 'pulito'

    const html = generaHTML(testo, tmpl, { nome, citta, piva, telefono, logo, colore })

      // Se c'è una versione padre, aggiorna is_ultimo
      if (versione_padre_id) {
        await supabase.from('preventivi').update({ is_ultimo: false }).eq('id', versione_padre_id)
      }

      // Recupera numero versione
      let versione = 1
      if (versione_padre_id) {
        const { data: padre } = await supabase.from('preventivi').select('versione').eq('id', versione_padre_id).single()
        if (padre) versione = (padre.versione || 1) + 1
      }

      res.json({ html, versione })

    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

// ── Funzione generaHTML ────────────────────────────────────────────
function generaHTML(testo, template, dati) {
  const { nome, citta, piva, telefono, logo, colore } = dati
  const data = new Date().toLocaleDateString('it-IT')
  const logoHtml = logo ? `<img src="${logo}" style="max-height:60px;max-width:180px;object-fit:contain;" />` : ''

  const templates = {
    pulito: `
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 40px; color: #1a1a1a; background: #fff; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 20px; border-bottom: 2px solid #${colore}; }
        .company { font-size: 22px; font-weight: bold; color: #${colore}; }
        .meta { font-size: 12px; color: #666; line-height: 1.8; }
        .title { font-size: 18px; font-weight: bold; color: #${colore}; margin-bottom: 20px; }
        .content { font-size: 13px; line-height: 1.9; white-space: pre-wrap; color: #333; }
        .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #eee; font-size: 11px; color: #999; }
      </style>
      <div class="header">
        <div>${logoHtml}<div class="company">${nome}</div><div class="meta">${citta}${piva ? ' · P.IVA ' + piva : ''}${telefono ? ' · ' + telefono : ''}</div></div>
        <div class="meta" style="text-align:right">Data: ${data}<br>Validità: 30 giorni</div>
      </div>
      <div class="title">PREVENTIVO</div>
      <div class="content">${testo}</div>
      <div class="footer">${nome} · ${citta}</div>`,

    classico: `
      <style>
        body { font-family: 'Times New Roman', serif; margin: 0; padding: 40px; color: #111; background: #fff; }
        .header { text-align: center; border: 2px solid #${colore}; padding: 20px; margin-bottom: 28px; }
        .company { font-size: 24px; font-weight: bold; color: #${colore}; }
        .meta { font-size: 12px; color: #555; margin-top: 6px; }
        .title { text-align: center; font-size: 16px; font-weight: bold; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 24px; color: #${colore}; border-bottom: 1px solid #ccc; padding-bottom: 10px; }
        .content { font-size: 13px; line-height: 2; white-space: pre-wrap; color: #222; }
        .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #888; border-top: 1px solid #ccc; padding-top: 12px; }
      </style>
      <div class="header">${logoHtml}<div class="company">${nome}</div><div class="meta">${citta}${piva ? ' · P.IVA ' + piva : ''}${telefono ? ' · ' + telefono : ''}</div></div>
      <div class="title">Preventivo</div>
      <div class="content">${testo}</div>
      <div class="footer">Data: ${data} · Validità: 30 giorni · ${nome}</div>`,

    bold: `
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 0; color: #1a1a1a; background: #fff; }
        .header { background: #${colore}; color: white; padding: 32px 40px; }
        .company { font-size: 26px; font-weight: bold; }
        .meta { font-size: 12px; opacity: 0.75; margin-top: 4px; }
        .body { padding: 32px 40px; }
        .title { font-size: 16px; font-weight: bold; color: #${colore}; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 1px; }
        .content { font-size: 13px; line-height: 1.9; white-space: pre-wrap; color: #333; }
        .footer { padding: 16px 40px; background: #f5f5f5; font-size: 11px; color: #888; }
      </style>
      <div class="header">${logoHtml}<div class="company">${nome}</div><div class="meta">${citta}${piva ? ' · P.IVA ' + piva : ''}${telefono ? ' · Tel: ' + telefono : ''}</div></div>
      <div class="body"><div class="title">Preventivo · ${data}</div><div class="content">${testo}</div></div>
      <div class="footer">${nome} · Validità offerta: 30 giorni</div>`,

    minimal_dark: `
      <style>
        body { font-family: 'Helvetica Neue', sans-serif; margin: 0; padding: 0; color: #fff; background: #${colore}; }
        .header { padding: 40px; border-bottom: 1px solid rgba(255,255,255,0.15); }
        .company { font-size: 22px; font-weight: 300; letter-spacing: 2px; text-transform: uppercase; }
        .meta { font-size: 11px; opacity: 0.5; margin-top: 4px; letter-spacing: 1px; }
        .body { padding: 40px; background: #1a1a2e; }
        .title { font-size: 13px; font-weight: 600; letter-spacing: 3px; text-transform: uppercase; color: rgba(255,255,255,0.4); margin-bottom: 20px; }
        .content { font-size: 13px; line-height: 2; white-space: pre-wrap; color: rgba(255,255,255,0.85); }
        .footer { padding: 20px 40px; background: #${colore}; font-size: 11px; color: rgba(255,255,255,0.4); }
      </style>
      <div class="header">${logoHtml}<div class="company">${nome}</div><div class="meta">${citta}${piva ? ' · ' + piva : ''}</div></div>
      <div class="body"><div class="title">Preventivo · ${data}</div><div class="content">${testo}</div></div>
      <div class="footer">${telefono || ''} · Validità 30 giorni</div>`,

    artigiano: `
      <style>
        body { font-family: Georgia, serif; margin: 0; padding: 40px; color: #2c1810; background: #fdfaf5; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px; padding-bottom: 16px; border-bottom: 3px double #${colore}; }
        .company { font-size: 24px; font-weight: bold; color: #${colore}; font-style: italic; }
        .meta { font-size: 12px; color: #8b6355; line-height: 1.8; }
        .title { font-size: 17px; font-weight: bold; color: #${colore}; margin-bottom: 20px; font-style: italic; }
        .content { font-size: 13px; line-height: 2; white-space: pre-wrap; color: #2c1810; }
        .footer { margin-top: 40px; padding-top: 14px; border-top: 3px double #${colore}; font-size: 11px; color: #8b6355; text-align: center; font-style: italic; }
      </style>
      <div class="header">
        <div>${logoHtml}<div class="company">${nome}</div><div class="meta">${citta}${piva ? ' · P.IVA ' + piva : ''}${telefono ? '<br>' + telefono : ''}</div></div>
        <div class="meta" style="text-align:right">Data: ${data}<br>Validità: 30 giorni</div>
      </div>
      <div class="title">Preventivo</div>
      <div class="content">${testo}</div>
      <div class="footer">"La qualità del lavoro ben fatto" · ${nome}</div>`
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body>${templates[template] || templates.pulito}</body></html>`
}
// ── POST /api/salva-pdf ────────────────────────────────────────────
app.post('/api/salva-pdf', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return

  try {
    const { pdf_base64 } = req.body
    if (!pdf_base64) return res.status(400).json({ error: 'PDF mancante' })

    const pdfBuffer = Buffer.from(pdf_base64, 'base64')
    const fileName = `${user.id}/${Date.now()}.pdf`

    const { error } = await supabase.storage
      .from('preventivi-pdf')
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: false
      })

    if (error) return res.status(500).json({ error: error.message })

    const { data: urlData } = supabase.storage
      .from('preventivi-pdf')
      .getPublicUrl(fileName)

    res.json({ pdf_url: urlData.publicUrl })
  } catch (err) { // <--- Sostituito con (err)
    res.status(500).json({ error: err.message })
  }
})
app.listen(PORT, () => {
  console.log(`✅ PreventivoAI backend attivo su porta ${PORT}`)
})