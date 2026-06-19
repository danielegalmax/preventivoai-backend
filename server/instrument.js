require('dotenv').config()

const Sentry = require('@sentry/node')

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'messages',
  'recap',
  'testo',
  'pdf_base64',
  'immagine_base64',
  'logo_base64',
  'documento_base64',
  'audio_base64',
  'authorization',
  'api_key',
  'secret',
  'stripe',
  'service_key',
])

function filterSensitiveValue(key, value) {
  if (SENSITIVE_KEYS.has(String(key).toLowerCase())) return '[Filtered]'
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return filterSensitiveObject(value)
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => filterSensitiveValue(String(index), item))
  }
  return value
}

function filterSensitiveObject(obj) {
  if (!obj || typeof obj !== 'object') return '[Filtered]'
  const out = {}
  for (const [key, value] of Object.entries(obj)) {
    out[key] = filterSensitiveValue(key, value)
  }
  return out
}

function sanitizeEvent(event) {
  if (event.request?.headers) {
    const headers = { ...event.request.headers }
    delete headers.authorization
    delete headers.Authorization
    delete headers.cookie
    delete headers.Cookie
    event.request.headers = headers
  }

  delete event.request?.cookies

  if (event.request?.data !== undefined) {
    if (typeof event.request.data === 'string') {
      event.request.data = '[Filtered]'
    } else if (typeof event.request.data === 'object' && event.request.data !== null) {
      event.request.data = filterSensitiveObject(event.request.data)
    }
  }

  return event
}

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || process.env.RAILWAY_ENVIRONMENT || 'development',
    sendDefaultPii: false,
    beforeSend: sanitizeEvent,
  })
} else {
  console.warn('[sentry] SENTRY_DSN non configurato — monitoraggio errori disattivato')
}

module.exports = Sentry
