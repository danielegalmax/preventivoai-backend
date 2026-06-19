const { supabase } = require('../config')

const BUCKET_PREVENTIVI_PDF = 'preventivi-pdf'
/** PDF dell'artigiano (accesso da app loggata, rigenerabile on demand). */
const SIGNED_URL_EXPIRY_ARTIGIANO_SEC = 60 * 60
/** PDF firmato / documenti per il cliente finale (pagina firma). */
const SIGNED_URL_EXPIRY_CLIENTE_SEC = 30 * 24 * 60 * 60
/** PNG firma embedded nel PDF durante la generazione (stessa richiesta). */
const SIGNED_URL_EXPIRY_RENDER_SEC = 60 * 60

async function createSignedPreventiviPdfUrl(storagePath, expiresInSeconds) {
  const { data, error } = await supabase.storage
    .from(BUCKET_PREVENTIVI_PDF)
    .createSignedUrl(storagePath, expiresInSeconds)

  if (error) throw new Error(error.message)
  return data.signedUrl
}

/**
 * Accetta un path Storage (`userId/file.pdf`) o un URL legacy da getPublicUrl().
 */
function storagePathFromPdfReference(reference) {
  if (!reference || typeof reference !== 'string') return null

  const trimmed = reference.trim()
  if (!trimmed) return null
  if (!/^https?:\/\//i.test(trimmed)) return trimmed

  const patterns = [
    /\/storage\/v1\/object\/(?:public|sign)\/preventivi-pdf\/(.+?)(?:\?|$)/,
    /\/preventivi-pdf\/(.+?)(?:\?|$)/,
  ]

  for (const pattern of patterns) {
    const match = trimmed.match(pattern)
    if (match) return decodeURIComponent(match[1])
  }

  return null
}

async function signedUrlForPdfReference(reference, expiresInSeconds) {
  const path = storagePathFromPdfReference(reference)
  if (!path) return null
  return createSignedPreventiviPdfUrl(path, expiresInSeconds)
}

async function signedUrlClientePdfReference(reference) {
  return signedUrlForPdfReference(reference, SIGNED_URL_EXPIRY_CLIENTE_SEC)
}

async function signedUrlArtigianoPdfReference(reference) {
  return signedUrlForPdfReference(reference, SIGNED_URL_EXPIRY_ARTIGIANO_SEC)
}

async function signedUrlRenderPdfReference(reference) {
  return signedUrlForPdfReference(reference, SIGNED_URL_EXPIRY_RENDER_SEC)
}

module.exports = {
  BUCKET_PREVENTIVI_PDF,
  SIGNED_URL_EXPIRY_ARTIGIANO_SEC,
  SIGNED_URL_EXPIRY_CLIENTE_SEC,
  SIGNED_URL_EXPIRY_RENDER_SEC,
  createSignedPreventiviPdfUrl,
  storagePathFromPdfReference,
  signedUrlForPdfReference,
  signedUrlClientePdfReference,
  signedUrlArtigianoPdfReference,
  signedUrlRenderPdfReference,
}
