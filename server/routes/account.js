const express = require('express')
const router = express.Router()
const { supabase } = require('../config')
const verificaUtente = require('../middleware/auth')
const { asyncRoute } = require('../utils/http')

function isMissingTableError(error) {
  return error && (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /does not exist|Could not find the table|schema cache/i.test(error.message || '')
  )
}

async function deleteIfTableExists(table, buildQuery) {
  const { error } = await buildQuery(supabase.from(table))
  if (!error) return { table, deleted: true }
  if (isMissingTableError(error)) return { table, deleted: false, skipped: true, reason: 'missing_table' }
  throw error
}

async function listStorageFiles(bucket, prefix) {
  const files = []

  async function walk(path) {
    const { data, error } = await supabase.storage.from(bucket).list(path, { limit: 1000 })
    if (error) {
      return
    }

    for (const item of data || []) {
      const itemPath = path ? `${path}/${item.name}` : item.name
      if (item.id) files.push(itemPath)
      else await walk(itemPath)
    }
  }

  await walk(prefix)
  return files
}

async function removeStoragePrefix(bucket, prefix) {
  const files = await listStorageFiles(bucket, prefix)
  for (let i = 0; i < files.length; i += 100) {
    const chunk = files.slice(i, i + 100)
    if (chunk.length > 0) {
      const { error } = await supabase.storage.from(bucket).remove(chunk)
      if (error) return { bucket, deleted: false, error: error.message }
    }
  }
  return { bucket, deleted: true, files: files.length }
}

router.post('/api/elimina-account', asyncRoute(async (req, res) => {
  const user = await verificaUtente(req, res)
  if (!user) return

  const report = {
    storage: [],
    tables: [],
  }

  report.storage.push(await removeStoragePrefix('preventivi-pdf', user.id))
  report.storage.push(await removeStoragePrefix('loghi', user.id))

  const { data: abbonamenti } = await supabase
    .from('abbonamenti')
    .select('id')
    .eq('user_id', user.id)

  const abbonamentoIds = (abbonamenti || []).map(a => a.id)

  if (abbonamentoIds.length > 0) {
    report.tables.push(await deleteIfTableExists('rate_abbonamento', q => q.delete().in('abbonamento_id', abbonamentoIds)))
  } else {
    report.tables.push({ table: 'rate_abbonamento', deleted: true, skipped: true, reason: 'no_abbonamenti' })
  }

  // Prodotti digitali: prima gli acquisti collegati (FK), poi le righe prodotto (hard delete come preventivi).
  const { data: prodottiDigitali } = await supabase
    .from('prodotti_digitali')
    .select('id')
    .eq('user_id', user.id)

  const prodottoIds = (prodottiDigitali || []).map(p => p.id)

  if (prodottoIds.length > 0) {
    report.tables.push(await deleteIfTableExists('acquisti_prodotti', q => q.delete().in('prodotto_id', prodottoIds)))
  }

  const deletions = [
    ['preventivi', q => q.delete().eq('user_id', user.id)],
    ['clienti', q => q.delete().eq('user_id', user.id)],
    ['servizi', q => q.delete().eq('user_id', user.id)],
    ['abbonamenti', q => q.delete().eq('user_id', user.id)],
    ['prodotti_digitali', q => q.delete().eq('user_id', user.id)],
    ['notifiche', q => q.delete().eq('user_id', user.id)],
    ['metodi_pagamento', q => q.delete().eq('user_id', user.id)],
    ['eventi', q => q.delete().eq('user_id', user.id)],
    ['ai_usage', q => q.delete().eq('user_id', user.id)],
    ['sessioni', q => q.delete().eq('user_id', user.id)],
    ['segnalazioni', q => q.delete().eq('user_id', user.id)],
    ['profiles', q => q.delete().eq('id', user.id)],
  ]

  for (const [table, buildQuery] of deletions) {
    report.tables.push(await deleteIfTableExists(table, buildQuery))
  }

  const { error: authError } = await supabase.auth.admin.deleteUser(user.id)
  if (authError) throw authError

  res.json({ success: true, report })
}))

module.exports = router
