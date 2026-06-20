const express = require('express')
const router = express.Router()
const { supabase } = require('../config')
const { creaNotifica, urlFirma } = require('../utils/firmaData')

const GIORNI_SCADENZA_RATE_DEFAULT = 3
const ORE_DEDUP = 24

function parseGiorniScadenzaRate() {
  const raw = process.env.CRON_GIORNI_SCADENZA_RATE
  const n = raw != null ? Number(raw) : GIORNI_SCADENZA_RATE_DEFAULT
  return Number.isFinite(n) && n >= 0 ? n : GIORNI_SCADENZA_RATE_DEFAULT
}

function verificaCronSecret(req, res) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    res.status(401).json({ error: 'Non autorizzato' })
    return false
  }
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth
  if (token !== secret) {
    res.status(401).json({ error: 'Non autorizzato' })
    return false
  }
  return true
}

function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function dataScadenzaRata(anno, mese, giornoScadenza) {
  const ultimoGiorno = new Date(anno, mese, 0).getDate()
  const giorno = Math.min(Math.max(1, giornoScadenza), ultimoGiorno)
  return new Date(anno, mese - 1, giorno)
}

function scadenzaEntroProssimiGiorni(scadenza, giorni, oggi = startOfDay(new Date())) {
  const fine = new Date(oggi)
  fine.setDate(fine.getDate() + giorni)
  const s = startOfDay(scadenza)
  return s >= oggi && s <= fine
}

function formatDataIt(isoDate) {
  return new Date(isoDate).toLocaleDateString('it-IT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatImportoEuro(n) {
  return Number(n).toFixed(2).replace('.', ',')
}

function invioPiuRecentePerPreventivo(invii) {
  const map = new Map()
  for (const invio of invii) {
    const prev = map.get(invio.preventivo_id)
    if (!prev || new Date(invio.inviato_at) > new Date(prev.inviato_at)) {
      map.set(invio.preventivo_id, invio)
    }
  }
  return [...map.values()]
}

function preventiviBloccatiReminder(notifiche, dedupSince) {
  const blocked = new Set()
  for (const n of notifiche) {
    if (!n.preventivo_id) continue
    if (!n.letta || new Date(n.created_at) >= dedupSince) {
      blocked.add(n.preventivo_id)
    }
  }
  return blocked
}

function rateBloccate(notifiche) {
  const blocked = new Set()
  for (const n of notifiche) {
    const rataId = n.payload?.rata_id
    if (rataId) blocked.add(rataId)
  }
  return blocked
}

async function caricaProfiliReminder(userIds) {
  if (userIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, reminder_firma_giorni, reminder_firma_globale_disabilitato')
    .in('id', userIds)
  if (error) throw new Error(error.message)
  return new Map((data || []).map(p => [p.id, p]))
}

async function controllaReminderFirma(dedupSince) {
  const { data: inviiRaw, error } = await supabase
    .from('preventivo_invii')
    .select(`
      id,
      user_id,
      preventivo_id,
      inviato_at,
      link_token,
      preventivi(
        id,
        titolo,
        nome_cliente,
        clienti(nome, telefono, email)
      )
    `)
    .is('firmato_at', null)
    .is('revocato_at', null)
    .eq('reminder_disabilitato', false)

  if (error) throw new Error(error.message)

  const invii = invioPiuRecentePerPreventivo(inviiRaw || [])
  if (invii.length === 0) return 0

  const preventivoIds = [...new Set(invii.map(i => i.preventivo_id).filter(Boolean))]
  const { data: notificheEsistenti, error: errNotifiche } = await supabase
    .from('notifiche')
    .select('preventivo_id, letta, created_at')
    .eq('tipo', 'reminder_firma')
    .in('preventivo_id', preventivoIds)

  if (errNotifiche) throw new Error(errNotifiche.message)

  const blocked = preventiviBloccatiReminder(notificheEsistenti || [], dedupSince)
  const profili = await caricaProfiliReminder([...new Set(invii.map(i => i.user_id))])
  const now = Date.now()
  let creati = 0

  for (const invio of invii) {
    if (blocked.has(invio.preventivo_id)) continue

    const profilo = profili.get(invio.user_id)
    if (profilo?.reminder_firma_globale_disabilitato) continue

    const giorni = typeof profilo?.reminder_firma_giorni === 'number'
      ? profilo.reminder_firma_giorni
      : 3
    const sogliaMs = giorni * 24 * 60 * 60 * 1000
    if (now - new Date(invio.inviato_at).getTime() < sogliaMs) continue

    const preventivo = invio.preventivi
    const nomeCliente = preventivo?.clienti?.nome || preventivo?.nome_cliente || 'Cliente'
    const titoloPreventivo = preventivo?.titolo || 'Preventivo'
    const url = invio.link_token ? urlFirma(invio.link_token) : undefined

    await creaNotifica({
      userId: invio.user_id,
      tipo: 'reminder_firma',
      preventivoId: invio.preventivo_id,
      invioId: invio.id,
      titolo: 'Promemoria firma',
      messaggio: `${nomeCliente} non ha ancora firmato «${titoloPreventivo}». Inviare un reminder?`,
      payload: {
        nomeCliente,
        urlFirma: url,
        emailCliente: preventivo?.clienti?.email || undefined,
        telefonoCliente: preventivo?.clienti?.telefono || undefined,
      },
    })
    blocked.add(invio.preventivo_id)
    creati += 1
  }

  return creati
}

async function controllaRateInScadenza(giorniScadenza, dedupSince) {
  const { data: rateRaw, error } = await supabase
    .from('rate_abbonamento')
    .select(`
      id,
      mese,
      anno,
      importo,
      acconto,
      stato,
      abbonamento_id,
      abbonamenti(
        id,
        attivo,
        giorno_scadenza,
        tipo,
        nome,
        preventivo_id,
        deleted_at,
        cliente_id,
        clienti(user_id, nome)
      )
    `)
    .in('stato', ['da_incassare', 'parziale'])

  if (error) throw new Error(error.message)

  const { data: notificheEsistenti, error: errNotifiche } = await supabase
    .from('notifiche')
    .select('payload')
    .eq('tipo', 'rata_in_scadenza')
    .gte('created_at', dedupSince.toISOString())

  if (errNotifiche) throw new Error(errNotifiche.message)

  const blocked = rateBloccate(notificheEsistenti || [])
  let creati = 0

  for (const rata of rateRaw || []) {
    if (blocked.has(rata.id)) continue

    const abbonamento = rata.abbonamenti
    if (!abbonamento?.attivo || abbonamento.deleted_at) continue

    const scadenza = dataScadenzaRata(rata.anno, rata.mese, abbonamento.giorno_scadenza)
    if (!scadenzaEntroProssimiGiorni(scadenza, giorniScadenza)) continue

    const userId = abbonamento.clienti?.user_id
    if (!userId) continue

    const clienteNome = abbonamento.clienti?.nome || 'Cliente'
    const residuo = rata.importo - (rata.acconto || 0)
    const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']
    const etichettaMese = `${MESI[rata.mese - 1]} ${rata.anno}`
    const pianoLabel = abbonamento.nome || (abbonamento.tipo === 'canone' ? 'Canone' : 'Piano rate')

    await creaNotifica({
      userId,
      tipo: 'rata_in_scadenza',
      preventivoId: abbonamento.preventivo_id || null,
      invioId: null,
      titolo: 'Rata in scadenza',
      messaggio: `${clienteNome}: €${formatImportoEuro(residuo)} per ${etichettaMese} (${pianoLabel}) scade il ${formatDataIt(scadenza)}.`,
      payload: {
        rata_id: rata.id,
        abbonamento_id: rata.abbonamento_id,
        cliente_id: abbonamento.cliente_id,
        cliente_nome: clienteNome,
        importo_residuo: residuo,
        scadenza: scadenza.toISOString(),
        mese: rata.mese,
        anno: rata.anno,
        tipo_piano: abbonamento.tipo,
      },
    })
    blocked.add(rata.id)
    creati += 1
  }

  return creati
}

router.post('/api/cron/controlli-giornalieri', async (req, res) => {
  if (!verificaCronSecret(req, res)) return

  try {
    const dedupSince = new Date(Date.now() - ORE_DEDUP * 60 * 60 * 1000)
    const giorniScadenzaRate = parseGiorniScadenzaRate()

    const reminderFirmaCreati = await controllaReminderFirma(dedupSince)
    const rataInScadenzaCreati = await controllaRateInScadenza(giorniScadenzaRate, dedupSince)

    res.json({
      ok: true,
      reminder_firma_creati: reminderFirmaCreati,
      rata_in_scadenza_creati: rataInScadenzaCreati,
      eseguito_at: new Date().toISOString(),
    })
  } catch (err) {
    console.error('controlli-giornalieri', err)
    res.status(500).json({ error: err.message || 'Errore interno' })
  }
})

module.exports = router
