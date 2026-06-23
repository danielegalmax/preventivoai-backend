const express = require('express')
const rateLimit = require('express-rate-limit')
const verificaUtente = require('../middleware/auth')
const { trackEvento } = require('../utils/analytics')

const router = express.Router()

const trackRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.trackUser?.id || req.ip,
  message: { error: 'Troppe richieste di tracking, riprova più tardi' },
})

async function authForTrack(req, res, next) {
  const user = await verificaUtente(req, res)
  if (!user) return
  req.trackUser = user
  next()
}

// POST /api/track — eventi da client mobile/desktop
//
// Body: { evento, schermata?, dati? }
//
// Eventi previsti (client):
// - Schermata apertura: { evento: 'schermata_aperta', schermata: 'home|chat|storico|clienti|...' }
// - Preventivo salvato: { evento: 'preventivo_salvato', dati: { importo, template } }
// - Cliente creato: { evento: 'cliente_creato' }
// - Abbonamento creato: { evento: 'abbonamento_creato', dati: { tipo: 'canone|rate' } }
// - Firma inviata: { evento: 'firma_inviata' }
// - Login: { evento: 'login', dati: { metodo: 'email|google|biometrico' } }
router.post('/api/track', authForTrack, trackRateLimit, (req, res) => {
  const { evento, schermata, dati } = req.body || {}
  if (!evento || typeof evento !== 'string') {
    return res.status(400).json({ error: 'evento mancante' })
  }

  trackEvento({
    userId: req.trackUser.id,
    evento,
    schermata: schermata ?? null,
    dati: dati ?? null,
  })

  res.json({ ok: true })
})

module.exports = router
