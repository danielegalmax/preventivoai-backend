const { Resend } = require('resend')

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

const FROM = 'PreventivoAI <onboarding@resend.dev>'

async function inviaEmailPagamentoRicevuto({ emailArtigiano, nomeArtigiano, importo, numeroPreventivo }) {
  if (!resend) return
  try {
    await resend.emails.send({
      from: FROM,
      to: emailArtigiano,
      subject: `Pagamento ricevuto — ${numeroPreventivo || 'Preventivo'}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 16px">
          <h2 style="color:#0D1B2A">Pagamento ricevuto 🎉</h2>
          <p>Ciao${nomeArtigiano ? ` ${nomeArtigiano}` : ''},</p>
          <p>Hai ricevuto un pagamento di <strong>€${importo}</strong>${numeroPreventivo ? ` per il preventivo <strong>${numeroPreventivo}</strong>` : ''}.</p>
          <p>Il preventivo è stato marcato come <strong>pagato</strong> nel tuo account PreventivoAI.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
          <p style="font-size:12px;color:#888">PreventivoAI — Solvex</p>
        </div>
      `
    })
  } catch (err) {
    console.error('[email] inviaEmailPagamentoRicevuto:', err.message)
  }
}

async function inviaEmailPagamentoClienteOk({ emailCliente, nomeCliente, importo, nomeArtigiano, numeroPreventivo }) {
  if (!resend) return
  try {
    await resend.emails.send({
      from: FROM,
      to: emailCliente,
      subject: `Pagamento confermato — ${numeroPreventivo || 'Preventivo'}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 16px">
          <h2 style="color:#0D1B2A">Pagamento confermato ✓</h2>
          <p>Ciao${nomeCliente ? ` ${nomeCliente}` : ''},</p>
          <p>Il tuo pagamento di <strong>€${importo}</strong>${numeroPreventivo ? ` per il preventivo <strong>${numeroPreventivo}</strong>` : ''}${nomeArtigiano ? ` di <strong>${nomeArtigiano}</strong>` : ''} è andato a buon fine.</p>
          <p>Grazie per aver pagato tramite PreventivoAI.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
          <p style="font-size:12px;color:#888">PreventivoAI — Solvex</p>
        </div>
      `
    })
  } catch (err) {
    console.error('[email] inviaEmailPagamentoClienteOk:', err.message)
  }
}

module.exports = { inviaEmailPagamentoRicevuto, inviaEmailPagamentoClienteOk }
