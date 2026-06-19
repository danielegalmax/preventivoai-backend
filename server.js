require('./server/instrument')

const express = require('express')
const cors = require('cors')
const Sentry = require('@sentry/node')
require('./server/config')

const chatRoutes = require('./server/routes/chat')
const pdfRoutes = require('./server/routes/pdf')
const clientiRoutes = require('./server/routes/clienti')
const profiloRoutes = require('./server/routes/profilo')
const varieRoutes = require('./server/routes/varie')
const accountRoutes = require('./server/routes/account')
const firmaRoutes = require('./server/routes/firma')

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// TEMP: test integrazione Sentry — rimuovere dopo verifica manuale
app.get('/api/test-sentry-temp', () => {
  throw new Error('Test Sentry - errore di prova, da rimuovere')
})

app.use(chatRoutes)
app.use(pdfRoutes)
app.use(clientiRoutes)
app.use(profiloRoutes)
app.use(varieRoutes)
app.use(accountRoutes)
app.use(firmaRoutes)

if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app)
}

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err)
  res.status(500).json({ error: 'Errore interno' })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`✅ PreventivoAI backend attivo su porta ${PORT}`)
})

// v2.1
