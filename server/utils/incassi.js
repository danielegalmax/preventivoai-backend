const { supabase } = require('../config')

async function calcolaIncassatoTotale(userId) {
  const { data: preventivi, error: e1 } = await supabase
    .from('preventivi')
    .select('id, importo_totale, cliente_id')
    .eq('user_id', userId)
    .eq('stato', 'accettato')
    .eq('pagato', true)
    .eq('is_ultimo', true)
    .is('deleted_at', null)

  if (e1) throw e1

  const { data: abbonamenti, error: e2 } = await supabase
    .from('abbonamenti')
    .select('preventivo_id')
    .eq('user_id', userId)
    .eq('attivo', true)
    .not('preventivo_id', 'is', null)
    .is('deleted_at', null)

  if (e2) throw e2

  const preventiviConPiano = new Set(abbonamenti.map((a) => a.preventivo_id))

  const sommaPreventivi = preventivi
    .filter((p) => !preventiviConPiano.has(p.id))
    .reduce((tot, p) => tot + (p.importo_totale || 0), 0)

  const { data: rate, error: e3 } = await supabase
    .from('rate_abbonamento')
    .select('importo, acconto, stato, abbonamento_id, abbonamenti!inner(user_id, attivo, deleted_at)')
    .eq('abbonamenti.user_id', userId)
    .eq('abbonamenti.attivo', true)
    .is('abbonamenti.deleted_at', null)
    .in('stato', ['incassato', 'parziale'])

  if (e3) throw e3

  const sommaRate = rate.reduce((tot, r) => {
    if (r.stato === 'incassato') return tot + (r.importo || 0)
    if (r.stato === 'parziale') return tot + (r.acconto || 0)
    return tot
  }, 0)

  return sommaPreventivi + sommaRate
}

module.exports = { calcolaIncassatoTotale }
