const WINDOW_MS = 10 * 60 * 1000
const MAX_REQUESTS = 30

/** @type {Map<string, number[]>} */
const richiestePerUtente = new Map()

function pulisciTimestamps(timestamps, now) {
  return timestamps.filter((t) => now - t < WINDOW_MS)
}

function controllaLimiteAi(userId) {
  const now = Date.now()
  const precedenti = richiestePerUtente.get(userId) || []
  const attivi = pulisciTimestamps(precedenti, now)

  if (attivi.length >= MAX_REQUESTS) {
    richiestePerUtente.set(userId, attivi)
    return { allowed: false, count: attivi.length, retryAfterMs: WINDOW_MS - (now - attivi[0]) }
  }

  attivi.push(now)
  richiestePerUtente.set(userId, attivi)
  return { allowed: true, count: attivi.length }
}

function applicaLimiteAi(userId, endpoint, res) {
  const esito = controllaLimiteAi(userId)
  if (esito.allowed) return true

  const retryMin = Math.max(1, Math.ceil((esito.retryAfterMs || WINDOW_MS) / 60000))
  console.warn(
    `[ai-rate-limit] endpoint=${endpoint} richieste=${esito.count}/${MAX_REQUESTS} finestra=${WINDOW_MS / 60000}min retry~${retryMin}min`,
  )
  res.status(429).json({ error: 'Troppe richieste, riprova tra qualche minuto' })
  return false
}

module.exports = { applicaLimiteAi, controllaLimiteAi, MAX_REQUESTS, WINDOW_MS }
