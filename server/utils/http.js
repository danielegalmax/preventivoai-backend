function sendError(res, err, fallback = 'Errore interno') {
  const message = err?.message || fallback
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
