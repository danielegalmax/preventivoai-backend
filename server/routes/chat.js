const express = require('express')
const router = express.Router()
const { anthropic, supabase } = require('../config')
const verificaUtente = require('../middleware/auth')

router.post('/api/chat', async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return

  const { messages, cliente_id } = req.body
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

  // Carica dati cliente se disponibile
  let clienteTesto = ''
  if (cliente_id) {
    const { data: cliente } = await supabase
      .from('clienti')
      .select('nome, telefono, email, indirizzo, note')
      .eq('id', cliente_id)
      .single()
    if (cliente) {
      clienteTesto = `\nCLIENTE PER QUESTO PREVENTIVO:\n- Nome: ${cliente.nome}${cliente.telefono ? '\n- Telefono: ' + cliente.telefono : ''}${cliente.email ? '\n- Email: ' + cliente.email : ''}${cliente.indirizzo ? '\n- Indirizzo: ' + cliente.indirizzo : ''}${cliente.note ? '\n- Note: ' + cliente.note : ''}`
    }
  }

  const serviziTesto = servizi && servizi.length > 0
    ? servizi.map(s => `- ${s.nome}${s.descrizione ? ': ' + s.descrizione : ''}${s.costo ? ' â€” â‚¬' + s.costo + '/' + s.unita : ''}`).join('\n')
    : profile?.listino || 'Nessun listino specificato'

  const system = `Sei l'assistente commerciale di ${profile.nome_azienda || 'questa azienda'}, ${profile.categoria || 'artigiano'} a ${profile.citta || 'Italia'}.

Il tuo compito Ã¨ raccogliere le informazioni necessarie per generare un preventivo professionale, poi chiedere conferma prima di generarlo.

SERVIZI E LISTINO PREZZI:
${serviziTesto}${clienteTesto ? '\n' + clienteTesto : ''}

ISTRUZIONI CLIENTE:
- Se conosci giÃ  il cliente (cliente_id fornito), menziona il suo nome e NON chiedere per chi Ã¨
- Se NON conosci il cliente, durante la raccolta info chiedi "Per chi Ã¨ questo preventivo?" in modo naturale
- Se riesci a identificare il nome del cliente dal messaggio dell'utente, scrivi CLIENTE:[nome] su una riga all'inizio della tua risposta (prima di qualsiasi altro testo). Esempio: CLIENTE:Mario Rossi
- Scrivi CLIENTE:[nome] solo se sei ragionevolmente sicuro che sia il nome del destinatario del preventivo, non un nome generico
- Se il cliente_id Ã¨ giÃ  fornito, NON scrivere CLIENTE:

TONO: ${profile.tono || 'professionale e diretto'}

FLUSSO DA SEGUIRE:
1. Ascolta la descrizione del lavoro
2. Se mancano informazioni importanti, fai UNA domanda alla volta â€” la piÃ¹ urgente
3. Prima di fare il recap, chiedi SEMPRE in un unico messaggio: "Vuoi applicare uno sconto o condizioni particolari? Sei in regime forfettario (senza IVA) o ordinario?"
4. Dopo la risposta alla domanda su sconto/IVA, scrivi UN SOLO messaggio del tipo: "Perfetto! Ho tutto quello che mi serve. Posso procedere con il preventivo?" â€” NON scrivere ancora RECAP_PRONTO, aspetta la risposta dell'utente
5. Solo dopo che l'utente conferma (scrive "sÃ¬", "ok", "vai", "procedi" o simili), scrivi RECAP_PRONTO su una riga, poi il riepilogo
6. NON scrivere mai PREVENTIVO_PRONTO direttamente dalla chat â€” il preventivo viene generato solo dal bottone nell'app
7. Se l'utente vuole modificare qualcosa dopo il recap, torna al punto 2
FORMATO RECAP (dopo RECAP_PRONTO):
---
ðŸ“‹ RIEPILOGO LAVORO

Cliente: [nome se disponibile]
Lavoro: [descrizione breve]
Servizi previsti:
SERVIZIO: [nome] â€” DETTAGLI: [inclusi breve] â€” PREZZO: â‚¬XX

Totale stimato: â‚¬XX

Vuoi che generi il preventivo con questi dati, o vuoi aggiungere/modificare qualcosa?
---

FORMATO PREVENTIVO (dopo PREVENTIVO_PRONTO):
---
PREVENTIVO â€” ${profile.nome_azienda || 'Azienda'}
Data: ${new Date().toLocaleDateString('it-IT')}  |  ValiditÃ : 30 giorni

SERVIZI:

SERVIZIO: [nome servizio]
DETTAGLI:
- [voce inclusa 1]
- [voce inclusa 2]
PREZZO: â‚¬XX

RIEPILOGO:
Imponibile: â‚¬XX
IVA 22%: â‚¬XX
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
TOTALE: â‚¬XX

Note: [breve nota se necessaria]
Contatti: ${profile.nome_azienda || 'Azienda'} Â· ${profile.citta || 'Italia'}
---

REGOLE FORMATO:
- Ogni servizio ha SEMPRE SERVIZIO:, DETTAGLI: e PREZZO:
- I DETTAGLI sono sempre una lista con trattini
- Se c'Ã¨ un bundle aggiungilo come servizio separato es. "Bundle: Foto + Video"
- Il RIEPILOGO viene sempre alla fine

REGOLE:
- Usa sempre i servizi del listino. Non inventare prezzi.
- Fai massimo una domanda per messaggio.
- Sii conciso e diretto.
- OBBLIGATORIO: il flusso Ã¨ sempre â€” domande â†’ sconto/IVA â†’ conferma â†’ RECAP_PRONTO. Non saltare passaggi.
- VIETATO: scrivere RECAP_PRONTO prima che l'utente abbia confermato esplicitamente al punto 4.
- VIETATO: scrivere PREVENTIVO_PRONTO in qualsiasi messaggio â€” il preventivo viene generato solo dall'app.
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

// â”€â”€ POST /api/converti-recap â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/api/converti-recap', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  try {
    const { recap } = req.body
    const { data: profile } = await supabase
      .from('profiles')
      .select('nome_azienda, citta, piva, telefono')
      .eq('id', user.id)
      .single()

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Converti questo riepilogo in un preventivo formattato. Rispondi SOLO con il preventivo, nient'altro, nessuna introduzione.

RIEPILOGO:
${recap}

FORMATO OBBLIGATORIO:
PREVENTIVO â€” ${profile?.nome_azienda || 'Azienda'}
Data: ${new Date().toLocaleDateString('it-IT')}  |  ValiditÃ : 30 giorni

SERVIZI:

SERVIZIO: [nome servizio]
DETTAGLI:
- [dettaglio 1]
- [dettaglio 2]
PREZZO: â‚¬XX

RIEPILOGO:
Imponibile: â‚¬XX
IVA 22%: â‚¬XX
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
TOTALE: â‚¬XX

Se il regime Ã¨ forfettario ometti IVA e scrivi solo TOTALE.`
      }]
    })
    res.json({ preventivo: response.content[0].text.trim() })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// â”€â”€ POST /api/cerca-cliente â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

module.exports = router
