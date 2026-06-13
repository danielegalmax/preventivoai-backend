const { supabase } = require('../config')

async function verificaUtente(req, res) {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Non autorizzato' })
    return null
  }
  const token = auth.replace('Bearer ', '')
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) {
    res.status(401).json({ error: 'Token non valido' })
    return null
  }
  return user
}

// ── GET /health ───────────────────────────────────────────────────

module.exports = verificaUtente
