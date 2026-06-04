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
app.use(express.json({ limit: '50mb' }))

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
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

// ── GET /health ───────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ── GET /api/profilo ──────────────────────────────────────────────
app.get('/api/profilo', async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single()
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

  const { data: profile } = await supabase
    .from('profiles')
    .select('nome_azienda, citta, piva, telefono, listino, tono, categoria')
    .eq('id', user.id)
    .single()

  const { data: servizi } = await supabase
    .from('servizi')
    .select('nome, descrizione, costo, unita')
    .eq('user_id', user.id)
    .order('ordine', { ascending: true })

  const serviziTesto = servizi && servizi.length > 0
    ? servizi.map(s => `- ${s.nome}${s.descrizione ? ': ' + s.descrizione : ''}${s.costo ? ' — €' + s.costo + '/' + s.unita : ''}`).join('\n')
    : profile?.listino || 'Nessun listino specificato'

  const system = `Sei l'assistente commerciale di ${profile.nome_azienda || 'questa azienda'}, ${profile.categoria || 'artigiano'} a ${profile.citta || 'Italia'}.

Il tuo compito è raccogliere le informazioni necessarie per generare un preventivo professionale, poi chiedere conferma prima di generarlo.

SERVIZI E LISTINO PREZZI:
${serviziTesto}

TONO: ${profile.tono || 'professionale e diretto'}

FLUSSO DA SEGUIRE:
1. Ascolta la descrizione del lavoro
2. Se mancano informazioni importanti, fai UNA domanda alla volta — la più urgente
3. Prima di fare il recap, chiedi sempre in un unico messaggio: "Vuoi applicare uno sconto o condizioni particolari? Sei in regime forfettario (senza IVA) o ordinario?"
4. Dopo la risposta, scrivi esattamente: "Perfetto! Confermo il preventivo con questi dati, vuoi procedere?" e aspetta conferma
5. Solo dopo la conferma esplicita, scrivi RECAP_PRONTO su una riga, poi il riepilogo
6. NON scrivere mai PREVENTIVO_PRONTO senza che l'utente abbia prima visto il recap e confermato
7. Solo dopo che l'utente clicca "Genera preventivo" nel recap, scrivi PREVENTIVO_PRONTO su una riga, poi il preventivo
FORMATO RECAP (dopo RECAP_PRONTO):
---
📋 RIEPILOGO LAVORO

Cliente: [nome se disponibile]
Lavoro: [descrizione breve]
Servizi previsti:
SERVIZIO: [nome] — DETTAGLI: [inclusi breve] — PREZZO: €XX

Totale stimato: €XX

Vuoi che generi il preventivo con questi dati, o vuoi aggiungere/modificare qualcosa?
---

FORMATO PREVENTIVO (dopo PREVENTIVO_PRONTO):
---
PREVENTIVO — ${profile.nome_azienda || 'Azienda'}
Data: ${new Date().toLocaleDateString('it-IT')}  |  Validità: 30 giorni

SERVIZI:

SERVIZIO: [nome servizio]
DETTAGLI:
- [voce inclusa 1]
- [voce inclusa 2]
PREZZO: €XX

RIEPILOGO:
Imponibile: €XX
IVA 22%: €XX
─────────────────
TOTALE: €XX

Note: [breve nota se necessaria]
Contatti: ${profile.nome_azienda || 'Azienda'} · ${profile.citta || 'Italia'}
---

REGOLE FORMATO:
- Ogni servizio ha SEMPRE SERVIZIO:, DETTAGLI: e PREZZO:
- I DETTAGLI sono sempre una lista con trattini
- Se c'è un bundle aggiungilo come servizio separato es. "Bundle: Foto + Video"
- Il RIEPILOGO viene sempre alla fine

REGOLE:
- Usa sempre i servizi del listino. Non inventare prezzi.
- Fai massimo una domanda per messaggio.
- Sii conciso e diretto.
- OBBLIGATORIO: dopo aver raccolto tutte le informazioni incluso lo sconto, scrivi RECAP_PRONTO seguito dal riepilogo. Senza eccezioni.
- VIETATO: scrivere PREVENTIVO_PRONTO prima di aver scritto RECAP_PRONTO e ricevuto conferma esplicita.
- Solo dopo che l'utente scrive "sì", "ok", "genera", "confermo" o simili, scrivi PREVENTIVO_PRONTO.
- Se l'utente non conferma o vuole modificare qualcosa, aggiorna il recap e chiedi di nuovo conferma.
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
})

// ── POST /api/trascrivi ────────────────────────────────────────────
app.post('/api/trascrivi', express.json({ limit: '50mb' }), async (req, res) => {
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
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/trascrizioni ──────────────────────────────────────────
app.get('/api/trascrizioni', async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  const { data, error } = await supabase.from('trascrizioni').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ── POST /api/upload-logo ──────────────────────────────────────────
app.post('/api/upload-logo', express.json(), async (req, res) => {
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
app.post('/api/genera-pdf', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  try {
    const { testo, template, versione_padre_id } = req.body
    const { data: profile } = await supabase.from('profiles').select('nome_azienda, citta, piva, telefono, logo_url, colore_brand, template_preferito').eq('id', user.id).single()
    const colore = profile?.colore_brand || '0D1B2A'
    const logo = profile?.logo_url || null
    const nome = profile?.nome_azienda || 'Azienda'
    const citta = profile?.citta || ''
    const piva = profile?.piva || ''
    const telefono = profile?.telefono || ''
    const tmpl = template || profile?.template_preferito || 'pulito'
    const html = generaHTML(testo, tmpl, { nome, citta, piva, telefono, logo, colore })
    if (versione_padre_id) {
      await supabase.from('preventivi').update({ is_ultimo: false }).eq('id', versione_padre_id)
    }
    let versione = 1
    if (versione_padre_id) {
      const { data: padre } = await supabase.from('preventivi').select('versione').eq('id', versione_padre_id).single()
      if (padre) versione = (padre.versione || 1) + 1
    }
    res.json({ html, versione })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/salva-pdf ────────────────────────────────────────────
app.post('/api/salva-pdf', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  try {
    const { pdf_base64 } = req.body
    if (!pdf_base64) return res.status(400).json({ error: 'PDF mancante' })
    const pdfBuffer = Buffer.from(pdf_base64, 'base64')
    const fileName = `${user.id}/${Date.now()}.pdf`
    const { error } = await supabase.storage.from('preventivi-pdf').upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: false })
    if (error) return res.status(500).json({ error: error.message })
    const { data: urlData } = supabase.storage.from('preventivi-pdf').getPublicUrl(fileName)
    res.json({ pdf_url: urlData.publicUrl })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/elabora-servizi ──────────────────────────────────────
app.post('/api/elabora-servizi', express.json(), async (req, res) => {
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
function parsaPreventivo(testo) {
  const righe = testo.split('\n').map(r => r.trim()).filter(r => r)
  
  let titolo = ''
  let data = ''
  let validita = '30 giorni'
  let problema = ''
  let voci = []
  let imponibile = ''
  let iva = ''
  let totale = ''
  let note = ''
  let contatti = ''
  let fase = 'header'
  let servizioCorrente = null

  for (const riga of righe) {
    if (riga.startsWith('PREVENTIVO')) { titolo = riga; fase = 'header'; continue }
    if (riga.startsWith('Data:')) {
      const match = riga.match(/Data:\s*([^\|]+)/)
      if (match) data = match[1].trim()
      const vMatch = riga.match(/Validità:\s*(.+)/)
      if (vMatch) validita = vMatch[1].trim()
      continue
    }
    if (riga.startsWith('Problema:')) { problema = riga.replace('Problema:', '').trim(); continue }
    if (riga === 'SERVIZI:' || riga === 'SERVIZI') { fase = 'servizi'; continue }
    
    // Nuovo formato SERVIZIO/DETTAGLI/PREZZO
    if (riga.startsWith('SERVIZIO:') && fase === 'servizi') {
      if (servizioCorrente) voci.push(servizioCorrente)
      servizioCorrente = { nome: riga.replace('SERVIZIO:', '').trim(), dettagli: [], prezzo: '', totale: '' }
      continue
    }
    if (riga === 'DETTAGLI:' && servizioCorrente) { continue }
    if (riga.startsWith('- ') && servizioCorrente && fase === 'servizi') {
      servizioCorrente.dettagli.push(riga.substring(2).trim())
      continue
    }
    if (riga.startsWith('PREZZO:') && servizioCorrente) {
      servizioCorrente.prezzo = riga.replace('PREZZO:', '').trim().replace('€', '')
      servizioCorrente.totale = servizioCorrente.prezzo
      continue
    }

    // Vecchio formato VOCI per compatibilità
    if (riga === 'VOCI:' || riga === 'VOCI') { fase = 'voci'; continue }
    if (riga.startsWith('- ') && fase === 'voci') {
      const testo_voce = riga.substring(2)
      const matchCompleto = testo_voce.match(/^(.+?)\s*[—-]\s*€?([\d.,]+)(?:\/\w+)?\s*=\s*€?([\d.,]+)/)
      if (matchCompleto) {
        voci.push({ nome: matchCompleto[1].trim(), dettagli: [], prezzo: matchCompleto[2].trim(), totale: matchCompleto[3].trim() })
      } else {
        const matchSemplice = testo_voce.match(/^(.+?):\s*€?([\d.,]+)/)
        if (matchSemplice) {
          voci.push({ nome: matchSemplice[1].trim(), dettagli: [], prezzo: matchSemplice[2].trim(), totale: matchSemplice[2].trim() })
        } else {
          voci.push({ nome: testo_voce, dettagli: [], prezzo: '', totale: '' })
        }
      }
      continue
    }

    if (riga === 'RIEPILOGO:') { 
      if (servizioCorrente) { voci.push(servizioCorrente); servizioCorrente = null }
      fase = 'totali'
      continue 
    }
    if (riga.startsWith('Imponibile:')) { imponibile = riga.replace('Imponibile:', '').trim(); continue }
    if (riga.startsWith('IVA')) { iva = riga; continue }
    if (riga.startsWith('TOTALE:')) { totale = riga.replace('TOTALE:', '').trim(); continue }
    if (riga.startsWith('Note:')) { note = riga.replace('Note:', '').trim(); continue }
    if (riga.startsWith('Contatti:')) { contatti = riga.replace('Contatti:', '').trim(); continue }
    if (riga.startsWith('─') || riga === '---') continue
  }

  if (servizioCorrente) voci.push(servizioCorrente)
  return { titolo, data, validita, problema, voci, imponibile, iva, totale, note, contatti }
}

// ── Funzione generaHTML ────────────────────────────────────────────
function generaHTML(testo, template, dati) {
  const { nome, citta, piva, telefono, logo, colore } = dati
  const data = new Date().toLocaleDateString('it-IT')
  const logoHtml = logo ? `<img src="${logo}" style="max-height:60px;max-width:180px;object-fit:contain;" />` : ''
  const p = parsaPreventivo(testo)
  const coloreHex = colore.startsWith('#') ? colore : `#${colore}`

function tabellaVoci(sfondoHeader, testoHeader, sfondoRiga, sfondoAlt, testoPrimario, testoSecondario, fontFamily) {
    if (p.voci.length === 0) return `<div style="font-family:${fontFamily};font-size:13px;white-space:pre-wrap;color:${testoPrimario};line-height:1.9">${testo}</div>`
    const righe = p.voci.map((v, i) => {
      const dettagliHtml = v.dettagli && v.dettagli.length > 0
        ? `<div style="margin-top:5px">${v.dettagli.map(d => `<div style="font-size:11px;color:${testoSecondario};padding-left:4px">• ${d}</div>`).join('')}</div>`
        : ''
      return `<tr style="background:${i % 2 === 0 ? sfondoRiga : sfondoAlt}"><td style="padding:10px 14px;font-size:13px;color:${testoPrimario};vertical-align:top"><strong>${v.nome}</strong>${dettagliHtml}</td><td style="padding:10px 14px;font-size:13px;color:${testoSecondario};text-align:right;vertical-align:top">${v.prezzo ? '€' + v.prezzo : ''}</td><td style="padding:10px 14px;font-size:13px;color:${testoPrimario};text-align:right;font-weight:600;vertical-align:top">${v.totale ? '€' + v.totale : ''}</td></tr>`
    }).join('')
    return `<table style="width:100%;border-collapse:collapse;font-family:${fontFamily};margin-bottom:20px"><thead><tr style="background:${sfondoHeader}"><th style="padding:10px 14px;font-size:11px;font-weight:700;color:${testoHeader};text-align:left;letter-spacing:1px;text-transform:uppercase">Servizio</th><th style="padding:10px 14px;font-size:11px;font-weight:700;color:${testoHeader};text-align:right;letter-spacing:1px;text-transform:uppercase">Prezzo</th><th style="padding:10px 14px;font-size:11px;font-weight:700;color:${testoHeader};text-align:right;letter-spacing:1px;text-transform:uppercase">Totale</th></tr></thead><tbody>${righe}</tbody></table>`
  }

  function riepilogoTotali(align, fontFamily, coloreTesto, coloreAccento, sfondo) {
    if (!p.totale && !p.imponibile) return ''
    return `<div style="display:flex;justify-content:${align};margin-top:8px"><div style="background:${sfondo};border-radius:8px;padding:16px 20px;min-width:220px;font-family:${fontFamily}">${p.imponibile ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:${coloreTesto};margin-bottom:6px"><span>Imponibile</span><span>${p.imponibile}</span></div>` : ''}${p.iva ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:${coloreTesto};margin-bottom:10px"><span>${p.iva.split(':')[0]}</span><span>${p.iva.split(':')[1] ? p.iva.split(':')[1].trim() : ''}</span></div>` : ''}${p.totale ? `<div style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;color:${coloreAccento};border-top:1px solid ${coloreTesto}20;padding-top:8px"><span>TOTALE</span><span>${p.totale}</span></div>` : ''}</div></div>`
  }

  const templates = {
    pulito: `<style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Inter',Arial,sans-serif;padding:48px;color:#1a1a2e;background:#fff;font-size:13px;line-height:1.6}</style><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:36px;padding-bottom:24px;border-bottom:2px solid ${coloreHex}"><div>${logoHtml ? `<div style="margin-bottom:10px">${logoHtml}</div>` : ''}<div style="font-size:20px;font-weight:700;color:${coloreHex};letter-spacing:-0.5px">${nome}</div><div style="font-size:11px;color:#888;margin-top:4px;line-height:1.8">${citta}${piva ? ' · P.IVA ' + piva : ''}${telefono ? ' · ' + telefono : ''}</div></div><div style="text-align:right;font-size:11px;color:#888;line-height:1.8"><div style="font-size:22px;font-weight:700;color:${coloreHex};letter-spacing:-0.5px;margin-bottom:6px">PREVENTIVO</div><div>Data: <strong>${data}</strong></div><div>Validità: ${p.validita || '30 giorni'}</div></div></div>${p.problema ? `<div style="background:#f8f9fa;border-left:3px solid ${coloreHex};padding:12px 16px;border-radius:0 6px 6px 0;margin-bottom:24px;font-size:13px;color:#444">${p.problema}</div>` : ''}${tabellaVoci(coloreHex, '#fff', '#fff', '#f8f9fa', '#1a1a2e', '#666', "'Inter',Arial,sans-serif")}${riepilogoTotali('flex-end', "'Inter',Arial,sans-serif", '#666', coloreHex, '#f8f9fa')}${p.note ? `<div style="margin-top:24px;padding:12px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:12px;color:#92400e"><strong>Note:</strong> ${p.note}</div>` : ''}<div style="margin-top:36px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#aaa;display:flex;justify-content:space-between"><span>${nome}${citta ? ' · ' + citta : ''}</span><span>Documento generato il ${data}</span></div>`,

    classico: `<style>@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Source+Serif+4:wght@300;400;600&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Source Serif 4',Georgia,serif;padding:48px;color:#1a1a1a;background:#fff}</style><div style="text-align:center;border:2px solid ${coloreHex};padding:24px;margin-bottom:32px;border-radius:4px">${logoHtml ? `<div style="margin-bottom:12px">${logoHtml}</div>` : ''}<div style="font-family:'Playfair Display',Georgia,serif;font-size:24px;font-weight:700;color:${coloreHex}">${nome}</div><div style="font-size:11px;color:#666;margin-top:6px">${citta}${piva ? ' · P.IVA ' + piva : ''}${telefono ? ' · ' + telefono : ''}</div></div><div style="display:flex;justify-content:space-between;margin-bottom:28px"><div style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:700;color:${coloreHex};letter-spacing:2px;text-transform:uppercase;border-bottom:2px solid ${coloreHex};padding-bottom:6px">Preventivo</div><div style="text-align:right;font-size:11px;color:#666;line-height:1.9">Data: ${data}<br>Validità: ${p.validita || '30 giorni'}</div></div>${p.problema ? `<div style="font-style:italic;color:#555;margin-bottom:20px;font-size:13px;padding:10px 0;border-bottom:1px solid #eee">${p.problema}</div>` : ''}${tabellaVoci(coloreHex, '#fff', '#fff', '#fafafa', '#1a1a1a', '#555', "'Source Serif 4',Georgia,serif")}${riepilogoTotali('flex-end', "'Source Serif 4',Georgia,serif", '#555', coloreHex, '#f9f9f9')}${p.note ? `<div style="margin-top:20px;font-size:12px;color:#666;font-style:italic"><strong>Note:</strong> ${p.note}</div>` : ''}<div style="margin-top:36px;text-align:center;font-size:11px;color:#999;border-top:1px solid #ddd;padding-top:12px;font-style:italic">${nome} · ${citta} · Validità 30 giorni</div>`,

    bold: `<style>@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Montserrat',Arial,sans-serif;margin:0;padding:0;color:#1a1a1a;background:#fff}</style><div style="background:${coloreHex};padding:36px 48px">${logoHtml ? `<div style="margin-bottom:12px;filter:brightness(0) invert(1)">${logoHtml}</div>` : ''}<div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-1px">${nome}</div><div style="font-size:11px;color:rgba(255,255,255,0.7);margin-top:4px">${citta}${piva ? ' · P.IVA ' + piva : ''}${telefono ? ' · ' + telefono : ''}</div></div><div style="background:#f8f9fa;padding:20px 48px;display:flex;justify-content:space-between;align-items:center;margin-bottom:32px"><div style="font-size:22px;font-weight:800;color:${coloreHex};text-transform:uppercase;letter-spacing:1px">Preventivo</div><div style="font-size:11px;color:#666;text-align:right;line-height:1.8">Data: <strong>${data}</strong><br>Validità: ${p.validita || '30 giorni'}</div></div><div style="padding:0 48px">${p.problema ? `<div style="background:${coloreHex}15;border-left:4px solid ${coloreHex};padding:12px 16px;border-radius:0 6px 6px 0;margin-bottom:24px;font-size:13px;font-weight:500;color:#333">${p.problema}</div>` : ''}${tabellaVoci(coloreHex, '#fff', '#fff', '#f8f9fa', '#1a1a1a', '#666', "'Montserrat',Arial,sans-serif")}${riepilogoTotali('flex-end', "'Montserrat',Arial,sans-serif", '#666', coloreHex, coloreHex + '10')}${p.note ? `<div style="margin-top:20px;padding:12px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:12px;color:#92400e"><strong>Note:</strong> ${p.note}</div>` : ''}</div><div style="margin-top:36px;padding:16px 48px;background:#f8f9fa;font-size:11px;color:#999;display:flex;justify-content:space-between"><span>${nome}</span><span>Validità offerta: 30 giorni</span></div>`,

    minimal_dark: `<style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Inter',Arial,sans-serif;margin:0;padding:0;background:#0d1b2a;color:#e2e8f0}</style><div style="padding:40px 48px;border-bottom:1px solid rgba(255,255,255,0.1)">${logoHtml ? `<div style="margin-bottom:12px;filter:brightness(0) invert(1)">${logoHtml}</div>` : ''}<div style="display:flex;justify-content:space-between;align-items:flex-end"><div><div style="font-size:20px;font-weight:300;letter-spacing:3px;text-transform:uppercase;color:#fff">${nome}</div><div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:4px;letter-spacing:1px">${citta}${piva ? ' · ' + piva : ''}</div></div><div style="text-align:right"><div style="font-size:18px;font-weight:600;color:#0e9f8e;letter-spacing:2px;text-transform:uppercase">Preventivo</div><div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:4px">${data} · Validità ${p.validita || '30 giorni'}</div></div></div></div><div style="padding:36px 48px;background:#111827">${p.problema ? `<div style="color:rgba(255,255,255,0.6);font-size:13px;margin-bottom:24px;padding:12px 16px;border:1px solid rgba(255,255,255,0.1);border-radius:6px">${p.problema}</div>` : ''}<table style="width:100%;border-collapse:collapse;margin-bottom:20px"><thead><tr style="border-bottom:1px solid rgba(255,255,255,0.15)"><th style="padding:10px 0;font-size:10px;font-weight:600;color:rgba(255,255,255,0.35);text-align:left;letter-spacing:2px;text-transform:uppercase">DESCRIZIONE</th><th style="padding:10px 0;font-size:10px;font-weight:600;color:rgba(255,255,255,0.35);text-align:right;letter-spacing:2px;text-transform:uppercase">PREZZO</th><th style="padding:10px 0;font-size:10px;font-weight:600;color:rgba(255,255,255,0.35);text-align:right;letter-spacing:2px;text-transform:uppercase">TOTALE</th></tr></thead><tbody>${p.voci.map(v => `<tr style="border-bottom:1px solid rgba(255,255,255,0.06)"><td style="padding:12px 0;font-size:13px;color:#e2e8f0">${v.nome}</td><td style="padding:12px 0;font-size:13px;color:rgba(255,255,255,0.5);text-align:right">${v.prezzo ? '€' + v.prezzo : ''}</td><td style="padding:12px 0;font-size:13px;color:#0e9f8e;font-weight:600;text-align:right">${v.totale ? '€' + v.totale : ''}</td></tr>`).join('')}</tbody></table>${p.totale ? `<div style="display:flex;justify-content:flex-end"><div style="min-width:200px">${p.imponibile ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:6px"><span>Imponibile</span><span>${p.imponibile}</span></div>` : ''}${p.iva ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:10px"><span>${p.iva.split(':')[0]}</span><span>${p.iva.split(':')[1] ? p.iva.split(':')[1].trim() : ''}</span></div>` : ''}<div style="display:flex;justify-content:space-between;font-size:16px;font-weight:600;color:#0e9f8e;border-top:1px solid rgba(255,255,255,0.1);padding-top:10px"><span>TOTALE</span><span>${p.totale}</span></div></div></div>` : ''}${p.note ? `<div style="margin-top:24px;padding:12px 16px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;font-size:12px;color:rgba(255,255,255,0.6)"><strong>Note:</strong> ${p.note}</div>` : ''}</div><div style="padding:16px 48px;font-size:10px;color:rgba(255,255,255,0.25);display:flex;justify-content:space-between"><span>${telefono || ''}</span><span>Validità 30 giorni</span></div>`,

    artigiano: `<style>@import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Lora',Georgia,serif;padding:48px;color:#2c1810;background:#fdfaf5}</style><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding-bottom:16px;border-bottom:3px double ${coloreHex}"><div>${logoHtml ? `<div style="margin-bottom:10px">${logoHtml}</div>` : ''}<div style="font-size:22px;font-weight:600;color:${coloreHex};font-style:italic">${nome}</div><div style="font-size:11px;color:#8b6355;margin-top:4px;line-height:1.8">${citta}${piva ? ' · P.IVA ' + piva : ''}${telefono ? '<br>' + telefono : ''}</div></div><div style="text-align:right;font-size:11px;color:#8b6355;line-height:1.8">Data: ${data}<br>Validità: ${p.validita || '30 giorni'}</div></div><div style="font-size:18px;font-weight:600;color:${coloreHex};font-style:italic;margin-bottom:20px;text-align:center">~ Preventivo ~</div>${p.problema ? `<div style="font-style:italic;color:#5c3d2e;margin-bottom:20px;padding:12px 16px;border-left:3px solid ${coloreHex};background:#fdf3e7;font-size:13px">${p.problema}</div>` : ''}<table style="width:100%;border-collapse:collapse;margin-bottom:20px"><thead><tr style="background:${coloreHex};color:#fff"><th style="padding:10px 14px;font-size:11px;font-weight:600;text-align:left;letter-spacing:1px">Descrizione</th><th style="padding:10px 14px;font-size:11px;font-weight:600;text-align:right;letter-spacing:1px">Prezzo</th><th style="padding:10px 14px;font-size:11px;font-weight:600;text-align:right;letter-spacing:1px">Totale</th></tr></thead><tbody>${p.voci.map((v, i) => `<tr style="background:${i % 2 === 0 ? '#fff' : '#fdf3e7'}"><td style="padding:10px 14px;font-size:13px;color:#2c1810">${v.nome}</td><td style="padding:10px 14px;font-size:13px;color:#8b6355;text-align:right">${v.prezzo ? '€' + v.prezzo : ''}</td><td style="padding:10px 14px;font-size:13px;font-weight:600;color:${coloreHex};text-align:right">${v.totale ? '€' + v.totale : ''}</td></tr>`).join('')}</tbody></table>${p.totale ? `<div style="display:flex;justify-content:flex-end"><div style="background:#fdf3e7;border:1px solid ${coloreHex}40;border-radius:6px;padding:14px 18px;min-width:200px">${p.imponibile ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:#8b6355;margin-bottom:6px"><span>Imponibile</span><span>${p.imponibile}</span></div>` : ''}${p.iva ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:#8b6355;margin-bottom:10px"><span>${p.iva.split(':')[0]}</span><span>${p.iva.split(':')[1] ? p.iva.split(':')[1].trim() : ''}</span></div>` : ''}<div style="display:flex;justify-content:space-between;font-size:15px;font-weight:600;color:${coloreHex};border-top:1px solid ${coloreHex}40;padding-top:8px;font-style:italic"><span>Totale</span><span>${p.totale}</span></div></div></div>` : ''}${p.note ? `<div style="margin-top:20px;padding:12px 16px;background:#fdf3e7;border:1px dashed ${coloreHex}80;border-radius:6px;font-size:12px;color:#5c3d2e;font-style:italic"><strong>Note:</strong> ${p.note}</div>` : ''}<div style="margin-top:36px;padding-top:14px;border-top:3px double ${coloreHex};font-size:11px;color:#8b6355;text-align:center;font-style:italic">"La qualità del lavoro ben fatto" · ${nome}</div>`
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body>${templates[template] || templates.pulito}</body></html>`
}

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`✅ PreventivoAI backend attivo su porta ${PORT}`)
})
