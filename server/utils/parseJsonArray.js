function parseJsonArrayFromAI(text) {
  const clean = String(text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    const parsed = JSON.parse(clean)
    if (Array.isArray(parsed)) return parsed
    if (parsed && Array.isArray(parsed.servizi)) return parsed.servizi
    throw new Error('Risposta AI non è un array JSON')
  } catch (firstErr) {
    const start = clean.indexOf('[')
    const end = clean.lastIndexOf(']')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(clean.slice(start, end + 1))
      } catch {
        // continua con errore originale
      }
    }
    throw firstErr
  }
}

module.exports = { parseJsonArrayFromAI }
