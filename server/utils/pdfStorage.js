const { supabase } = require('../config')

async function salvaPdfSuStorage(userId, pdfBase64) {
  const pdfBuffer = Buffer.from(pdfBase64, 'base64')
  const fileName = `${userId}/${Date.now()}.pdf`
  const { error } = await supabase.storage
    .from('preventivi-pdf')
    .upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: false })

  if (error) return { error }

  const { data: urlData } = supabase.storage
    .from('preventivi-pdf')
    .getPublicUrl(fileName)

  return { pdfUrl: urlData.publicUrl }
}

module.exports = { salvaPdfSuStorage }
