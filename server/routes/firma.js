const express = require('express')
const router = express.Router()
const verificaUtente = require('../middleware/auth')
const { firmaPublicRateLimit } = require('../middleware/firmaRateLimit')
const { sendError } = require('../utils/http')
const { supabase } = require('../config')
const {
  urlFirma,
  creaInvio,
  invioAttivo,
  datiPaginaFirma,
  accettaFirma,
  registraFirmaManuale,
  annullaFirmaOnline,
  caricaPreventivoPerFirma,
  urlInvioFirmaArtigiano,
} = require('../utils/firmaData')

router.post('/api/preventivi/:id/invia-firma', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  try {
    const { id } = req.params
    const { canale } = req.body
    await caricaPreventivoPerFirma(id, user.id)
    const { invio, token, riuso } = await creaInvio({
      preventivoId: id,
      userId: user.id,
      canale: canale || 'link',
    })

    if (riuso) {
      return res.json({
        invio_id: invio.id,
        url: invio.link_token ? urlFirma(invio.link_token) : null,
        riuso: true,
        scade_at: invio.scade_at,
        messaggio: 'Link firma già attivo per questo preventivo.',
      })
    }

    res.json({
      invio_id: invio.id,
      url: urlFirma(token),
      token,
      riuso: false,
      scade_at: invio.scade_at,
    })
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/api/preventivi/:id/revoca-firma', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  try {
    const { id } = req.params
    await caricaPreventivoPerFirma(id, user.id)
    const attivo = await invioAttivo(id)
    if (!attivo) return res.status(404).json({ error: 'Nessun link firma attivo' })
    const { error } = await supabase
      .from('preventivo_invii')
      .update({ revocato_at: new Date().toISOString() })
      .eq('id', attivo.id)
    if (error) throw new Error(error.message)
    res.json({ ok: true })
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/api/preventivi/:id/firma-manuale', express.json({ limit: '10mb' }), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  try {
    const { id } = req.params
    const { documento_base64, mime_type } = req.body
    const result = await registraFirmaManuale(id, user.id, {
      documentoBase64: documento_base64,
      mimeType: mime_type,
    })
    res.json(result)
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/api/preventivi/:id/annulla-firma', express.json(), async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return
  try {
    const { id } = req.params
    const result = await annullaFirmaOnline(id, user.id)
    res.json(result)
  } catch (err) {
    sendError(res, err)
  }
})

router.get('/api/preventivi/:id/invio-firma-url', async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return

  try {
    const data = await urlInvioFirmaArtigiano(req.params.id, user.id)
    res.json(data)
  } catch (err) {
    if (err.message === 'Preventivo non trovato') {
      return res.status(404).json({ error: err.message })
    }
    if (err.message === 'Nessun invio firma trovato') {
      return res.status(404).json({ error: err.message })
    }
    sendError(res, err)
  }
})

router.get('/api/public/firma/:token', firmaPublicRateLimit, async (req, res) => {
  try {
    const data = await datiPaginaFirma(req.params.token)
    res.json(data)
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/api/public/firma/:token/accetta', firmaPublicRateLimit, express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const { firma_base64, accettato } = req.body
    const audit = {
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      user_agent: req.headers['user-agent'] || '',
    }
    const result = await accettaFirma(req.params.token, {
      firmaBase64: firma_base64,
      accettato: !!accettato,
    }, audit)

    if (!result.ok) {
      const status = result.errore === 'link_non_valido' ? 404 : 400
      return res.status(status).json({ error: result.errore })
    }

    res.json(result)
  } catch (err) {
    sendError(res, err)
  }
})

module.exports = router
