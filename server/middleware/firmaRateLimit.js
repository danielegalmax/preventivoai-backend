const rateLimit = require('express-rate-limit')

const WINDOW_MS = 10 * 60 * 1000
const MAX_REQUESTS = 30

const firmaPublicRateLimit = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429,
  message: { error: 'Troppe richieste, riprova più tardi' },
})

module.exports = { firmaPublicRateLimit, MAX_REQUESTS, WINDOW_MS }
