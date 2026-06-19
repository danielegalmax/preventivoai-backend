const { supabase } = require('../config')
const {
  BUCKET_PREVENTIVI_PDF,
  SIGNED_URL_EXPIRY_ARTIGIANO_SEC,
  createSignedPreventiviPdfUrl,
} = require('./pdfSignedUrls')

async function salvaPdfSuStorage(userId, pdfBase64) {
  const pdfBuffer = Buffer.from(pdfBase64, 'base64')
  const storagePath = `${userId}/${Date.now()}.pdf`
  const { error } = await supabase.storage
    .from(BUCKET_PREVENTIVI_PDF)
    .upload(storagePath, pdfBuffer, { contentType: 'application/pdf', upsert: false })

  if (error) return { error }

  const signedUrl = await createSignedPreventiviPdfUrl(storagePath, SIGNED_URL_EXPIRY_ARTIGIANO_SEC)
  return { pdfUrl: signedUrl, storagePath }
}

module.exports = { salvaPdfSuStorage }
