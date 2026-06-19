function sendError(res, err, fallback = 'Errore interno') {
  const message = err?.message || fallback
  if (process.env.SENTRY_DSN && err instanceof Error) {
    try {
      const Sentry = require('@sentry/node')
      Sentry.captureException(err)
    } catch {
      // Sentry non disponibile
    }
  }
  return res.status(500).json({ error: message })
}

function asyncRoute(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next)
    } catch (err) {
      sendError(res, err)
    }
  }
}

module.exports = { asyncRoute, sendError }
