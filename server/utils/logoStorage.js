const { supabase } = require('../config')

async function salvaLogoProfilo({ userId, logoBase64, mimeType }) {
  const filePath = `${userId}/logo`
  const { error } = await supabase.storage
    .from('loghi')
    .upload(filePath, Buffer.from(logoBase64, 'base64'), { contentType: mimeType || 'image/png', upsert: true })

  if (error) return { error }

  const { data: urlData } = supabase.storage.from('loghi').getPublicUrl(filePath)
  await supabase.from('profiles').update({ logo_url: urlData.publicUrl }).eq('id', userId)

  return { logoUrl: urlData.publicUrl }
}

module.exports = { salvaLogoProfilo }
