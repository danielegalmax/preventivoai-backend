const express = require('express')
const router = express.Router()
const verificaUtente = require('../middleware/auth')
const { applicaLimiteAi } = require('../middleware/aiRateLimit')
const { trackAI, trackEvento } = require('../utils/analytics')
const { sendError } = require('../utils/http')
const { creaMessaggioClaude } = require('../utils/aiClient')
const { caricaClienteChat, caricaProfiloChat, caricaProfiloConvertiRecap, caricaServiziChat } = require('../utils/chatData')

router.post('/api/chat', async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  if (!applicaLimiteAi(user.id, '/api/chat', res)) return

  const { messages, cliente_id } = req.body
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages mancanti' })
  }

  const profile = await caricaProfiloChat(user.id)
  const servizi = await caricaServiziChat(user.id)

  // Carica dati cliente se disponibile
  let clienteTesto = ''
  if (cliente_id) {
    const cliente = await caricaClienteChat(cliente_id, user.id)
    if (cliente) {
      clienteTesto = `\nCLIENTE PER QUESTO PREVENTIVO:\n- Nome: ${cliente.nome}${cliente.telefono ? '\n- Telefono: ' + cliente.telefono : ''}${cliente.email ? '\n- Email: ' + cliente.email : ''}${cliente.indirizzo ? '\n- Indirizzo: ' + cliente.indirizzo : ''}${cliente.note ? '\n- Note: ' + cliente.note : ''}`
    }
  }

  const serviziTesto = servizi && servizi.length > 0
    ? servizi.map(s => `- ${s.nome}${s.descrizione ? ': ' + s.descrizione : ''}${s.costo ? ' - EUR' + s.costo + '/' + s.unita : ''}`).join('\n')
    : profile?.listino || 'Nessun listino specificato'

  const system = `Sei l'assistente commerciale di ${profile.nome_azienda || 'questa azienda'}, ${profile.categoria || 'artigiano'} a ${profile.citta || 'Italia'}.

Il tuo compito e' raccogliere le informazioni necessarie per generare un preventivo professionale, poi chiedere conferma prima di generarlo.

SERVIZI E LISTINO PREZZI:
${serviziTesto}${clienteTesto ? '\n' + clienteTesto : ''}

ISTRUZIONI CLIENTE:
- Se conosci gia' il cliente (cliente_id fornito), menziona il suo nome e NON chiedere per chi e'
- Se NON conosci il cliente, durante la raccolta info chiedi "Per chi e' questo preventivo?" in modo naturale
- Se riesci a identificare il nome del cliente dal messaggio dell'utente, scrivi CLIENTE:[nome] su una riga all'inizio della tua risposta (prima di qualsiasi altro testo). Esempio: CLIENTE:Mario Rossi
- Scrivi CLIENTE:[nome] solo se sei ragionevolmente sicuro che sia il nome del destinatario del preventivo, non un nome generico
- Se il cliente_id e' gia' fornito, NON scrivere CLIENTE:

TONO: ${profile.tono || 'professionale e diretto'}

FLUSSO DA SEGUIRE:
1. Ascolta la descrizione del lavoro
2. Se mancano informazioni importanti, fai UNA domanda alla volta — la piu' urgente
3. Prima di fare il recap, chiedi SEMPRE in un unico messaggio tutte le domande opzionali ancora aperte tra queste — ma SOLO se l'utente non le ha gia' menzionate spontaneamente:
   - Vuoi applicare uno sconto? (percentuale es. 10% o importo fisso es. EUR 50)
   - Ci sono trasferte o rimborsi spese da aggiungere? (km percorsi o spese vive)
   - Vuoi strutturare il pagamento a rate, con acconto+saldo, o canone mensile?
   - Vuoi aggiungere l'IVA, applicare la ritenuta d'acconto (20%), o nessuno dei due?
   Se l'utente ha gia' risposto a una di queste durante la conversazione, NON richiederla. Raggruppa le domande mancanti in un unico messaggio.
4. Dopo la risposta, scrivi UN SOLO messaggio del tipo: "Perfetto! Ho tutto quello che mi serve. Posso procedere con il preventivo?" — NON scrivere ancora RECAP_PRONTO, aspetta la risposta dell'utente
5. Solo dopo che l'utente conferma (scrive "si'", "ok", "vai", "procedi" o simili), scrivi RECAP_PRONTO su una riga, poi il riepilogo
6. NON scrivere mai PREVENTIVO_PRONTO direttamente dalla chat — il preventivo viene generato solo dal bottone nell'app
7. Se l'utente vuole modificare qualcosa dopo il recap, torna al punto 2

REGOLE IVA E RITENUTA:
- Se l'utente dice che vuole l'IVA: includi Imponibile, IVA 22% e TOTALE nel riepilogo
- Se l'utente dice che vuole la ritenuta d'acconto: includi TOTALE IMPONIBILE, Ritenuta d'acconto 20% e TOTALE NETTO nel riepilogo
- Se l'utente dice che NON vuole ne' IVA ne' ritenuta, o non risponde, o dice "forfettario": scrivi solo TOTALE senza IVA
- NON assumere mai il regime fiscale — dipende solo da quello che dice l'utente

REGOLE SCONTO:
- Se l'utente vuole uno sconto percentuale (es. 10%): includi TOTALE LORDO e riga Sconto X% nel riepilogo
- Se l'utente vuole uno sconto fisso (es. EUR 50): includi TOTALE LORDO e riga Sconto nel riepilogo
- Lo sconto si applica sul totale (dopo IVA se presente)
- NON applicare mai sconti se l'utente non li ha richiesti esplicitamente

REGOLE TRASFERTE:
- Se l'utente menziona km percorsi: aggiungi blocco RIMBORSI SPESE con RIMBORSO: Trasferta km, DETTAGLIO: [N] km x EUR 0.25 = EUR [tot], TIPO: Imponibile
- Se l'utente menziona spese vive (parcheggio, materiali, ecc.): aggiungi RIMBORSO: [nome spesa], DETTAGLIO: Spesa viva, TIPO: Imponibile, IMPORTO: EUR [importo]
- NON aggiungere trasferte se l'utente non le ha menzionate

REGOLE PAGAMENTO:
- Se l'utente vuole pagamento a rate: scrivi NOTE PAGAMENTO: rate nel recap
- Se l'utente vuole acconto + saldo: scrivi NOTE PAGAMENTO: acconto+saldo nel recap
- Se l'utente vuole canone mensile: scrivi NOTE PAGAMENTO: canone mensile nel recap
- Non specificare importi rata — li calcola il sistema automaticamente
- NON aggiungere note pagamento se l'utente non le ha menzionate

FORMATO RECAP (dopo RECAP_PRONTO):
---
Riepilogo lavoro

Cliente: [nome se disponibile]
Lavoro: [descrizione breve]
Servizi previsti:
SERVIZIO: [nome] - DETTAGLI: [inclusi breve] - PREZZO: EUR XX

[Se ci sono trasferte o rimborsi:]
RIMBORSI SPESE:
RIMBORSO: Trasferta km
DETTAGLIO: [N] km x EUR 0.25 = EUR [tot]
TIPO: Imponibile

[oppure per spese vive:]
RIMBORSO: [nome spesa]
DETTAGLIO: Spesa viva
TIPO: Imponibile
IMPORTO: EUR [importo]

[Se sconto senza IVA:]
TOTALE LORDO: EUR XX
Sconto [X%|'']:  -EUR XX
─────────────────
TOTALE: EUR XX

[Se sconto con IVA:]
Imponibile: EUR XX
IVA 22%: EUR XX
TOTALE LORDO: EUR XX
Sconto [X%|'']: -EUR XX
─────────────────
TOTALE: EUR XX

[Se IVA senza sconto:]
Imponibile: EUR XX
IVA 22%: EUR XX
─────────────────
TOTALE: EUR XX

[Se ritenuta d'acconto:]
TOTALE IMPONIBILE: EUR XX
Ritenuta d'acconto 20%: -EUR XX
─────────────────
TOTALE NETTO: EUR XX

[Se NO IVA, NO ritenuta, NO sconto:]
TOTALE: EUR XX

[Se pagamento a rate / acconto+saldo / canone — solo se menzionato:]
NOTE PAGAMENTO: [rate | acconto+saldo | canone mensile]

Vuoi che generi il preventivo con questi dati, o vuoi aggiungere/modificare qualcosa?
---

FORMATO PREVENTIVO (dopo PREVENTIVO_PRONTO):
---
PREVENTIVO - ${profile.nome_azienda || 'Azienda'}
Data: ${new Date().toLocaleDateString('it-IT')}  |  Validita': 30 giorni

SERVIZI:

SERVIZIO: [nome servizio]
DETTAGLI:
- [voce inclusa 1]
- [voce inclusa 2]
PREZZO: EUR XX

[Se ci sono rimborsi spese:]
RIMBORSI SPESE:
RIMBORSO: [nome]
DETTAGLIO: [dettaglio]
TIPO: [Imponibile|Esente]
IMPORTO: EUR XX   ← solo per spese vive, non per km

[oppure per trasferta km:]
RIMBORSO: Trasferta km
DETTAGLIO: [N] km x EUR 0.25 = EUR [tot]
TIPO: Imponibile

RIEPILOGO:
[Se sconto senza IVA:]
TOTALE LORDO: EUR XX
Sconto [X%|'']: -EUR XX
─────────────────
TOTALE: EUR XX

[Se sconto con IVA:]
Imponibile: EUR XX
IVA 22%: EUR XX
TOTALE LORDO: EUR XX
Sconto [X%|'']: -EUR XX
─────────────────
TOTALE: EUR XX

[Se IVA senza sconto:]
Imponibile: EUR XX
IVA 22%: EUR XX
─────────────────
TOTALE: EUR XX

[Se ritenuta d'acconto:]
TOTALE IMPONIBILE: EUR XX
Ritenuta d'acconto 20%: -EUR XX
─────────────────
TOTALE NETTO: EUR XX

[Se NO IVA, NO ritenuta, NO sconto:]
TOTALE: EUR XX

[Se NOTE PAGAMENTO: rate:]
PAGAMENTO A RATE: da definire

[Se NOTE PAGAMENTO: acconto+saldo:]
PAGAMENTO A RATE: Acconto + saldo

[Se NOTE PAGAMENTO: canone mensile:]
CANONE MENSILE: da definire

Note: [breve nota se necessaria]
Contatti: ${profile.nome_azienda || 'Azienda'} - ${profile.citta || 'Italia'}
---

REGOLE FORMATO:
- Ogni servizio ha SEMPRE SERVIZIO:, DETTAGLI: e PREZZO:
- I DETTAGLI sono sempre una lista con trattini
- Se c'e' un bundle aggiungilo come servizio separato es. "Bundle: Foto + Video"
- Il RIEPILOGO viene sempre alla fine
- L'IVA nel riepilogo dipende SOLO da quello che ha detto l'utente in chat
- Se ci sono rimborsi: il blocco RIMBORSI SPESE viene dopo i SERVIZI e prima del RIEPILOGO
- Se c'e' sconto: TOTALE LORDO appare prima della riga Sconto, TOTALE finale e' il netto
- TOTALE IMPONIBILE e' usato SOLO per la ritenuta d'acconto fiscale
- NOTE PAGAMENTO appare solo se l'utente ha esplicitamente menzionato rate, acconto+saldo o canone mensile

REGOLE:
- Usa sempre i servizi del listino. Non inventare prezzi.
- Fai massimo una domanda per messaggio.
- Sii conciso e diretto.
- OBBLIGATORIO: il flusso e' sempre — domande → IVA/sconto → conferma → RECAP_PRONTO. Non saltare passaggi.
- VIETATO: scrivere RECAP_PRONTO prima che l'utente abbia confermato esplicitamente al punto 4.
- VIETATO: scrivere PREVENTIVO_PRONTO in qualsiasi messaggio — il preventivo viene generato solo dall'app.
- Tono: ${profile.tono || 'professionale e diretto'}.`

  try {
    const { response, latenzaMs } = await creaMessaggioClaude({
      max_tokens: 1024,
      system,
      messages
    })
    const reply = response.content[0].text
    
    trackAI({
      userId: user.id,
      endpoint: '/api/chat',
      tokenInput: response.usage.input_tokens,
      tokenOutput: response.usage.output_tokens,
      latenzaMs
    })
    trackEvento({ userId: user.id, evento: 'chat_messaggio', schermata: 'chat', dati: { ha_recap: reply.includes('RECAP_PRONTO') } })
    
    res.json({ reply })
  } catch (err) {
    console.error('Errore Claude:', err)
    sendError(res, new Error('Errore AI: ' + err.message))
  }
})

// POST /api/converti-recap
router.post('/api/converti-recap', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  if (!applicaLimiteAi(user.id, '/api/converti-recap', res)) return
  try {
    const { recap } = req.body
    const profile = await caricaProfiloConvertiRecap(user.id)

    const { response, latenzaMs } = await creaMessaggioClaude({
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Converti questo riepilogo in un preventivo formattato.
Rispondi SOLO con il preventivo, nient'altro, nessuna introduzione.

RIEPILOGO:
${recap}

FORMATO OBBLIGATORIO:
PREVENTIVO - ${profile?.nome_azienda || 'Azienda'}
Data: ${new Date().toLocaleDateString('it-IT')}  |  Validita': 30 giorni

SERVIZI:

SERVIZIO: [nome servizio]
DETTAGLI:
- [dettaglio 1]
- [dettaglio 2]
PREZZO: EUR XX

[Se ci sono rimborsi spese nel riepilogo:]
RIMBORSI SPESE:
RIMBORSO: [nome]
DETTAGLIO: [dettaglio]
TIPO: [Imponibile|Esente]
IMPORTO: EUR XX   ← solo per spese vive, non per km

[oppure per trasferta km:]
RIMBORSO: Trasferta km
DETTAGLIO: [N] km x EUR 0.25 = EUR [tot]
TIPO: Imponibile

RIEPILOGO:
[Se sconto senza IVA:]
TOTALE LORDO: EUR XX
Sconto [X%|'']: -EUR XX
─────────────────
TOTALE: EUR XX

[Se sconto con IVA:]
Imponibile: EUR XX
IVA 22%: EUR XX
TOTALE LORDO: EUR XX
Sconto [X%|'']: -EUR XX
─────────────────
TOTALE: EUR XX

[Se IVA senza sconto:]
Imponibile: EUR XX
IVA 22%: EUR XX
─────────────────
TOTALE: EUR XX

[Se ritenuta d'acconto:]
TOTALE IMPONIBILE: EUR XX
Ritenuta d'acconto 20%: -EUR XX
─────────────────
TOTALE NETTO: EUR XX

[Se NO IVA, NO ritenuta, NO sconto:]
TOTALE: EUR XX

[Se NOTE PAGAMENTO: rate nel riepilogo:]
PAGAMENTO A RATE: da definire

[Se NOTE PAGAMENTO: acconto+saldo nel riepilogo:]
PAGAMENTO A RATE: Acconto + saldo

[Se NOTE PAGAMENTO: canone mensile nel riepilogo:]
CANONE MENSILE: da definire

Note: [breve nota se presente nel riepilogo]
Contatti: ${profile?.nome_azienda || 'Azienda'}

REGOLE IMPORTANTI:
- Includi IVA SOLO se presente nel riepilogo originale
- Includi rimborsi SOLO se presenti nel riepilogo originale
- Includi sconto SOLO se presente nel riepilogo originale
- Includi NOTE PAGAMENTO SOLO se presenti nel riepilogo originale
- Non inventare dati non presenti nel riepilogo
- TOTALE IMPONIBILE e' usato SOLO per la ritenuta d'acconto fiscale`
      }]
    })
    trackAI({
      userId: user.id,
      endpoint: '/api/converti-recap',
      tokenInput: response.usage.input_tokens,
      tokenOutput: response.usage.output_tokens,
      latenzaMs
    })
    res.json({ preventivo: response.content[0].text.trim() })
  } catch (err) {
    sendError(res, err)
  }
})

module.exports = router
