const { supabase } = require('../config')

async function caricaProfilo(userId) {
  return supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
}

module.exports = { caricaProfilo }
