const fs = require('fs')

async function trascriviAudioBase64(audioBase64) {
  const buffer = Buffer.from(audioBase64, 'base64')
  const tempPath = `/tmp/audio_${Date.now()}.m4a`
  fs.writeFileSync(tempPath, buffer)

  try {
    const { default: OpenAI } = require('openai')
    const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const trascrizione = await openaiClient.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: 'whisper-1',
      language: 'it'
    })

    return trascrizione.text
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
  }
}

module.exports = { trascriviAudioBase64 }
