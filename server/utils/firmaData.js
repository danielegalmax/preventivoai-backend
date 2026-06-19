const crypto = require('crypto')
const { supabase } = require('../config')
const { generaHTML } = require('./templates')
const { generaPdfBufferDaHtml } = require('./pdfRenderer')

const GIORNI_SCADENZA = 30

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function generaToken() {
  const token = crypto.randomBytes(32).toString('base64url')
  return { token, tokenHash: hashToken(token) }
}

function baseUrlFirma() {
  return (process.env.FIRMA_WEB_BASE_URL || 'https://preventivoai-web.vercel.app').replace(/\/$/, '')
}

function urlFirma(token) {
  return `${baseUrlFirma()}/p/${token}`
}

async function caricaPreventivoPerFirma(preventivoId, userId) {
  const { data, error } = await supabase
    .from('preventivi')
    .select('id, user_id, testo_preventivo, template, importo_totale, stato, titolo, pdf_url, cliente_id, nome_cliente, clienti(nome, telefono, email, indirizzo)')
    .eq('id', preventivoId)
    .eq('user_id', userId)
    .single()
  if (error || !data) throw new Error('Preventivo non trovato')
  return data
}

async function invioAttivo(preventivoId) {
  const now = new Date().toISOString()
  const { data } = await supabase
    .from('preventivo_invii')
    .select('*')
    .eq('preventivo_id', preventivoId)
    .is('firmato_at', null)
    .is('revocato_at', null)
    .gt('scade_at', now)
    .order('inviato_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data
}

async function creaInvio({ preventivoId, userId, canale }) {
  const esistente = await invioAttivo(preventivoId)
  if (esistente) {
    return { invio: esistente, token: null, riuso: true }
  }

    const { token, tokenHash } = generaToken()
  const scadeAt = new Date()
  scadeAt.setDate(scadeAt.getDate() + GIORNI_SCADENZA)

  const { data: invio, error } = await supabase
    .from('preventivo_invii')
    .insert({
      preventivo_id: preventivoId,
      user_id: userId,
      token_hash: tokenHash,
      link_token: token,
      canale: canale || 'link',
      scade_at: scadeAt.toISOString(),
    })
    .select()
    .single()

  if (error) throw new Error(error.message)

  await supabase.from('preventivo_invii_eventi').insert({
    invio_id: invio.id,
    tipo: 'invio_iniziale',
  })

  await supabase
    .from('preventivi')
    .update({ stato: 'inviato' })
    .eq('id', preventivoId)
    .eq('user_id', userId)

  return { invio, token, riuso: false }
}

async function risolviInvioDaToken(token) {
  const tokenHash = hashToken(token)
  const { data: invio, error } = await supabase
    .from('preventivo_invii')
    .select('*, preventivi(id, testo_preventivo, template, importo_totale, stato, titolo, pdf_url, cliente_id, nome_cliente, user_id, clienti(nome))')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (error || !invio) return { errore: 'link_non_valido' }
  if (invio.revocato_at) return { errore: 'link_revocato', invio }
  if (invio.firmato_at) return { errore: 'gia_firmato', invio }
  if (new Date(invio.scade_at) < new Date()) return { errore: 'link_scaduto', invio }
  return { invio }
}

async function caricaProfiloPerPreventivo(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('nome_azienda, citta, piva, telefono, logo_url, colore_brand, template_preferito, note_pagamento, firma_nome, contatore_preventivi')
    .eq('id', userId)
    .single()
  return data
}

async function htmlPreventivoDaRecord(preventivo, profile) {
  const cliente = preventivo.clienti || (preventivo.nome_cliente ? { nome: preventivo.nome_cliente } : null)
  const tmpl = preventivo.template || profile?.template_preferito || 'pulito'
  const contatore = profile?.contatore_preventivi || 1
  const numeroPreventivo = `PRV-${new Date().getFullYear()}-${String(contatore).padStart(4, '0')}`

  return generaHTML(preventivo.testo_preventivo || '', tmpl, {
    nome: profile?.nome_azienda || 'Azienda',
    citta: profile?.citta || '',
    piva: profile?.piva || '',
    telefono: profile?.telefono || '',
    logo: profile?.logo_url || null,
    colore: profile?.colore_brand || '0D1B2A',
    notePagamento: profile?.note_pagamento || '',
    firmaNome: profile?.firma_nome || '',
    numeroPreventivo,
    clienteDati: cliente,
    nascondiPrezzi: false,
  })
}

/** Altezza riserva spazio fantasma per paginazione blocco 2 (px layout A4). */
const FIRMA_CLIENTE_RESERVE_PX = 148

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formattaDataFirma(firmatoAt) {
  const d = firmatoAt ? new Date(firmatoAt) : new Date()
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })
}

function bloccoFirmaCliente(firmaUrl, nomeCliente, firmatoAt) {
  const data = formattaDataFirma(firmatoAt)
  const nome = escapeHtml(nomeCliente || 'Cliente')
  return `
    <div data-section="firma-cliente" style="margin-top:18px;max-width:260px;text-align:left;min-height:${FIRMA_CLIENTE_RESERVE_PX}px;">
      <div style="font-size:10px;font-weight:600;color:#6B7280;letter-spacing:0.4px;text-transform:uppercase;margin-bottom:3px;">Data e firma del cliente</div>
      <div style="font-size:11px;color:#374151;margin-bottom:6px;">${escapeHtml(data)}</div>
      <img src="${firmaUrl}" alt="Firma ${nome}" style="display:block;height:48px;max-width:220px;object-fit:contain;object-position:left bottom;margin-bottom:5px;" />
      <div style="border-bottom:1px solid #374151;width:210px;"></div>
    </div>
  `
}

/** Inserisce il box firma nel flusso del macro blocco 2 (dopo footer, prima del page-footer). */
function inserisciBloccoFirmaInHtml(html, bloccoFirma) {
  const flagBody = html.includes('<body ')
    ? html.replace('<body ', '<body data-firma-pdf="true" ')
    : html.replace('<body>', '<body data-firma-pdf="true">')

  const anchor = 'data-page-footer-template'
  const pos = flagBody.indexOf(anchor)
  if (pos === -1) {
    return flagBody.replace('</body>', `${bloccoFirma}</body>`)
  }
  const insertAt = flagBody.lastIndexOf('<div', pos)
  if (insertAt === -1) {
    return flagBody.replace('</body>', `${bloccoFirma}</body>`)
  }
  return flagBody.slice(0, insertAt) + bloccoFirma + flagBody.slice(insertAt)
}

async function invioPendente(preventivoId) {
  const { data } = await supabase
    .from('preventivo_invii')
    .select('*')
    .eq('preventivo_id', preventivoId)
    .is('firmato_at', null)
    .order('inviato_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data
}

async function giaFirmato(preventivoId) {
  const { data } = await supabase
    .from('preventivo_invii')
    .select('id')
    .eq('preventivo_id', preventivoId)
    .not('firmato_at', 'is', null)
    .limit(1)
    .maybeSingle()
  return !!data
}

async function salvaDocumentoFirmaManuale(userId, preventivoId, invioId, documentoBase64, mimeType) {
  const raw = documentoBase64.replace(/^data:[^;]+;base64,/, '')
  const buffer = Buffer.from(raw, 'base64')
  const isPdf = mimeType === 'application/pdf' || mimeType?.includes('pdf')
  const ext = isPdf ? 'pdf' : mimeType?.includes('png') ? 'png' : 'jpg'
  const contentType = isPdf ? 'application/pdf' : mimeType?.includes('png') ? 'image/png' : 'image/jpeg'
  const path = `${userId}/firmati-manuali/${preventivoId}-${invioId}-${Date.now()}.${ext}`
  const { error } = await supabase.storage
    .from('preventivi-pdf')
    .upload(path, buffer, { contentType, upsert: false })
  if (error) throw new Error(error.message)
  const { data: urlData } = supabase.storage.from('preventivi-pdf').getPublicUrl(path)
  return { url: urlData.publicUrl, tipo: isPdf ? 'pdf' : 'immagine' }
}

async function creaInvioManuale(preventivoId, userId) {
  const { token, tokenHash } = generaToken()
  const scadeAt = new Date()
  scadeAt.setDate(scadeAt.getDate() + GIORNI_SCADENZA)
  const { data: invio, error } = await supabase
    .from('preventivo_invii')
    .insert({
      preventivo_id: preventivoId,
      user_id: userId,
      token_hash: tokenHash,
      link_token: token,
      canale: 'manuale',
      scade_at: scadeAt.toISOString(),
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return invio
}

async function registraFirmaManuale(preventivoId, userId, { documentoBase64, mimeType } = {}) {
  const preventivo = await caricaPreventivoPerFirma(preventivoId, userId)
  if (await giaFirmato(preventivoId)) {
    throw new Error('Preventivo già firmato')
  }

  let invio = await invioAttivo(preventivoId)
  if (!invio) invio = await invioPendente(preventivoId)
  if (!invio) invio = await creaInvioManuale(preventivoId, userId)

  const firmatoAt = new Date().toISOString()
  let firmaImmagineUrl = null
  let pdfFirmatoUrl = null

  if (documentoBase64) {
    const saved = await salvaDocumentoFirmaManuale(
      userId,
      preventivoId,
      invio.id,
      documentoBase64,
      mimeType || 'application/octet-stream',
    )
    if (saved.tipo === 'pdf') pdfFirmatoUrl = saved.url
    else firmaImmagineUrl = saved.url
  }

  const audit = {
    metodo: 'manuale',
    firmato_at: firmatoAt,
    mime_type: mimeType || null,
    documento_caricato: !!documentoBase64,
  }

  await supabase
    .from('preventivo_invii')
    .update({
      firmato_at: firmatoAt,
      metodo_firma: 'manuale',
      canale: invio.canale === 'manuale' || !invio.canale ? 'manuale' : invio.canale,
      firma_immagine_url: firmaImmagineUrl,
      pdf_firmato_url: pdfFirmatoUrl,
      audit_json: { ...(invio.audit_json || {}), ...audit },
      reminder_disabilitato: true,
    })
    .eq('id', invio.id)

  const updatePreventivo = { stato: 'accettato' }
  if (pdfFirmatoUrl) updatePreventivo.pdf_url = pdfFirmatoUrl
  await supabase.from('preventivi').update(updatePreventivo).eq('id', preventivoId).eq('user_id', userId)

  await supabase.from('preventivo_invii_eventi').insert({
    invio_id: invio.id,
    tipo: 'firma_manuale',
  })

  const nomeCliente = preventivo.clienti?.nome || preventivo.nome_cliente || 'Cliente'
  await creaNotifica({
    userId,
    tipo: 'firma_ricevuta',
    preventivoId,
    invioId: invio.id,
    titolo: 'Preventivo firmato a mano',
    messaggio: documentoBase64
      ? `${nomeCliente}: documento firmato caricato. Quando vuoi, segnalo come pagato?`
      : `${nomeCliente}: preventivo segnato come firmato a mano. Quando vuoi, segnalo come pagato?`,
    payload: { nomeCliente, pdfFirmatoUrl, firmaImmagineUrl, chiediPagato: true, metodo: 'manuale' },
  })

  return {
    ok: true,
    invio_id: invio.id,
    firmato_at: firmatoAt,
    pdf_firmato_url: pdfFirmatoUrl,
    firma_immagine_url: firmaImmagineUrl,
    metodo_firma: 'manuale',
  }
}

async function salvaImmagineFirma(userId, invioId, firmaBase64) {
  const base64 = firmaBase64.replace(/^data:image\/\w+;base64,/, '')
  const buffer = Buffer.from(base64, 'base64')
  const path = `${userId}/firme/${invioId}.png`
  const { error } = await supabase.storage
    .from('preventivi-pdf')
    .upload(path, buffer, { contentType: 'image/png', upsert: true })
  if (error) throw new Error(error.message)
  const { data: urlData } = supabase.storage.from('preventivi-pdf').getPublicUrl(path)
  return urlData.publicUrl
}

async function generaPdfFirmato(preventivo, profile, firmaUrl, nomeCliente, firmatoAt) {
  let html = await htmlPreventivoDaRecord(preventivo, profile)
  html = inserisciBloccoFirmaInHtml(html, bloccoFirmaCliente(firmaUrl, nomeCliente, firmatoAt))
  const pdfBuffer = await generaPdfBufferDaHtml(html)
  const path = `${preventivo.user_id}/firmati/${preventivo.id}-${Date.now()}.pdf`
  const { error } = await supabase.storage
    .from('preventivi-pdf')
    .upload(path, pdfBuffer, { contentType: 'application/pdf', upsert: false })
  if (error) throw new Error(error.message)
  const { data: urlData } = supabase.storage.from('preventivi-pdf').getPublicUrl(path)
  return urlData.publicUrl
}

async function creaNotifica({ userId, tipo, preventivoId, invioId, titolo, messaggio, payload }) {
  const { error } = await supabase.from('notifiche').insert({
    user_id: userId,
    tipo,
    preventivo_id: preventivoId,
    invio_id: invioId,
    titolo,
    messaggio,
    payload: payload || {},
  })
  if (error) console.error('creaNotifica', error.message)
}

async function accettaFirma(token, { firmaBase64, accettato }, audit) {
  const risolto = await risolviInvioDaToken(token)
  if (risolto.errore && risolto.errore !== 'gia_firmato') {
    return { ok: false, errore: risolto.errore }
  }
  if (risolto.errore === 'gia_firmato') {
    return {
      ok: true,
      giaFirmato: true,
      pdfFirmatoUrl: risolto.invio.pdf_firmato_url,
    }
  }

  if (!accettato) return { ok: false, errore: 'accettazione_richiesta' }
  if (!firmaBase64) return { ok: false, errore: 'firma_richiesta' }

  const invio = risolto.invio
  const preventivo = invio.preventivi
  const profile = await caricaProfiloPerPreventivo(invio.user_id)
  const nomeCliente = preventivo.clienti?.nome || preventivo.nome_cliente || 'Cliente'

  const firmatoAt = new Date().toISOString()
  const firmaUrl = await salvaImmagineFirma(invio.user_id, invio.id, firmaBase64)
  const pdfFirmatoUrl = await generaPdfFirmato(preventivo, profile, firmaUrl, nomeCliente, firmatoAt)

  await supabase
    .from('preventivo_invii')
    .update({
      firmato_at: firmatoAt,
      metodo_firma: 'online',
      firma_immagine_url: firmaUrl,
      pdf_firmato_url: pdfFirmatoUrl,
      audit_json: {
        ...audit,
        metodo: 'online',
        accettato_checkbox: true,
        firmato_at: firmatoAt,
      },
    })
    .eq('id', invio.id)

  await supabase
    .from('preventivi')
    .update({ stato: 'accettato', pdf_url: pdfFirmatoUrl })
    .eq('id', preventivo.id)

  await creaNotifica({
    userId: invio.user_id,
    tipo: 'firma_ricevuta',
    preventivoId: preventivo.id,
    invioId: invio.id,
    titolo: 'Preventivo firmato',
    messaggio: `${nomeCliente} ha accettato il preventivo. Quando vuoi, segnalo come pagato?`,
    payload: { nomeCliente, pdfFirmatoUrl, chiediPagato: true },
  })

  return { ok: true, pdfFirmatoUrl, nomeCliente, firmatoAt }
}

async function datiPaginaFirma(token) {
  const risolto = await risolviInvioDaToken(token)
  if (!risolto.invio) {
    return { stato: risolto.errore || 'link_non_valido' }
  }

  const invio = risolto.invio
  const preventivo = invio.preventivi
  const nomeCliente = preventivo?.clienti?.nome || preventivo?.nome_cliente || 'Cliente'
  const nomeAzienda = (await caricaProfiloPerPreventivo(invio.user_id))?.nome_azienda || 'Azienda'

  if (risolto.errore === 'gia_firmato') {
    return {
      stato: 'gia_firmato',
      nomeCliente,
      nomeAzienda,
      pdfFirmatoUrl: invio.pdf_firmato_url,
      firmatoAt: invio.firmato_at,
    }
  }
  if (risolto.errore === 'link_scaduto') {
    return { stato: 'scaduto', nomeCliente, nomeAzienda }
  }
  if (risolto.errore === 'link_revocato') {
    return { stato: 'revocato', nomeCliente, nomeAzienda }
  }

  const profile = await caricaProfiloPerPreventivo(invio.user_id)
  const html = await htmlPreventivoDaRecord(preventivo, profile)

  return {
    stato: 'pronto',
    nomeCliente,
    nomeAzienda,
    importoTotale: preventivo.importo_totale,
    titolo: preventivo.titolo,
    html,
    scadeAt: invio.scade_at,
  }
}

module.exports = {
  urlFirma,
  baseUrlFirma,
  creaInvio,
  invioAttivo,
  datiPaginaFirma,
  accettaFirma,
  registraFirmaManuale,
  caricaPreventivoPerFirma,
  creaNotifica,
  hashToken,
}
