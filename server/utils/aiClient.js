const { anthropic } = require('../config')

async function creaMessaggioClaude(params) {
  const inizio = Date.now()
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    ...params
  })

  return { response, latenzaMs: Date.now() - inizio }
}

module.exports = { creaMessaggioClaude }
