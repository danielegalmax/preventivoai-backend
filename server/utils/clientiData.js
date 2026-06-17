const { supabase } = require('../config')

async function cercaClientiPerNome(userId, nome) {
  const { data } = await supabase
    .from('clienti')
    .select('id, nome, telefono, email, indirizzo, note')
    .eq('user_id', userId)
    .ilike('nome', `%${nome}%`)
    .limit(5)

  return data || []
}

async function creaClienteChat({ userId, nome, telefono, email, indirizzo }) {
  return supabase
    .from('clienti')
    .insert({ user_id: userId, nome, telefono: telefono || null, email: email || null, indirizzo: indirizzo || null })
    .select()
    .single()
}

module.exports = { cercaClientiPerNome, creaClienteChat }
