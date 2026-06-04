// ── Parser testo preventivo ────────────────────────────────────────
function parsaPreventivo(testo) {
  const righe = testo.split('\n').map(r => r.trim()).filter(r => r)
  
  let titolo = ''
  let data = ''
  let validita = '30 giorni'
  let problema = ''
  let voci = []
  let imponibile = ''
  let iva = ''
  let totale = ''
  let note = ''
  let contatti = ''
  let fase = 'header'

  for (const riga of righe) {
    if (riga.startsWith('PREVENTIVO')) { titolo = riga; fase = 'header'; continue }
    if (riga.startsWith('Data:')) {
      const match = riga.match(/Data:\s*([^\|]+)/)
      if (match) data = match[1].trim()
      const vMatch = riga.match(/Validità:\s*(.+)/)
      if (vMatch) validita = vMatch[1].trim()
      continue
    }
    if (riga.startsWith('Problema:')) { problema = riga.replace('Problema:', '').trim(); continue }
    if (riga === 'VOCI:' || riga === 'VOCI') { fase = 'voci'; continue }
    if (riga.startsWith('- ') && fase === 'voci') {
      const testo_voce = riga.substring(2)
      // pattern: "Nome: descrizione — €XX/unita = €YY" oppure "Nome — €XX/unita = €YY"
      const matchCompleto = testo_voce.match(/^(.+?)\s*[—-]\s*€?([\d.,]+)(?:\/\w+)?\s*=\s*€?([\d.,]+)/)
      if (matchCompleto) {
        voci.push({
          nome: matchCompleto[1].trim(),
          prezzo: matchCompleto[2].trim(),
          totale: matchCompleto[3].trim()
        })
      } else {
        // pattern semplice: "Nome: €XX"
        const matchSemplice = testo_voce.match(/^(.+?):\s*€?([\d.,]+)/)
        if (matchSemplice) {
          voci.push({ nome: matchSemplice[1].trim(), prezzo: matchSemplice[2].trim(), totale: matchSemplice[2].trim() })
        } else {
          voci.push({ nome: testo_voce, prezzo: '', totale: '' })
        }
      }
      continue
    }
    if (riga.startsWith('Imponibile:')) { imponibile = riga.replace('Imponibile:', '').trim(); fase = 'totali'; continue }
    if (riga.startsWith('IVA')) { iva = riga; fase = 'totali'; continue }
    if (riga.startsWith('TOTALE:')) { totale = riga.replace('TOTALE:', '').trim(); fase = 'totali'; continue }
    if (riga.startsWith('Note:')) { note = riga.replace('Note:', '').trim(); continue }
    if (riga.startsWith('Contatti:')) { contatti = riga.replace('Contatti:', '').trim(); continue }
    if (riga.startsWith('─') || riga.startsWith('-─') || riga === '---') continue
  }

  return { titolo, data, validita, problema, voci, imponibile, iva, totale, note, contatti }
}

// ── Funzione generaHTML ────────────────────────────────────────────
function generaHTML(testo, template, dati) {
  const { nome, citta, piva, telefono, logo, colore } = dati
  const data = new Date().toLocaleDateString('it-IT')
  const logoHtml = logo ? `<img src="${logo}" style="max-height:60px;max-width:180px;object-fit:contain;" />` : ''
  const p = parsaPreventivo(testo)
  const coloreHex = colore.startsWith('#') ? colore : `#${colore}`

  // Genera tabella voci
  function tabellaVoci(sfondoHeader, testoHeader, sfondoRiga, sfondoAlt, testoPrimario, testoSecondario, fontFamily) {
    if (p.voci.length === 0) return `<div style="font-family:${fontFamily};font-size:13px;white-space:pre-wrap;color:${testoPrimario};line-height:1.9">${testo}</div>`
    
    const righe = p.voci.map((v, i) => `
      <tr style="background:${i % 2 === 0 ? sfondoRiga : sfondoAlt}">
        <td style="padding:10px 14px;font-size:13px;color:${testoPrimario}">${v.nome}</td>
        <td style="padding:10px 14px;font-size:13px;color:${testoSecondario};text-align:right">${v.prezzo ? '€' + v.prezzo : ''}</td>
        <td style="padding:10px 14px;font-size:13px;color:${testoPrimario};text-align:right;font-weight:600">${v.totale ? '€' + v.totale : ''}</td>
      </tr>`).join('')

    return `
      <table style="width:100%;border-collapse:collapse;font-family:${fontFamily};margin-bottom:20px">
        <thead>
          <tr style="background:${sfondoHeader}">
            <th style="padding:10px 14px;font-size:11px;font-weight:700;color:${testoHeader};text-align:left;letter-spacing:1px;text-transform:uppercase">Descrizione</th>
            <th style="padding:10px 14px;font-size:11px;font-weight:700;color:${testoHeader};text-align:right;letter-spacing:1px;text-transform:uppercase">Prezzo</th>
            <th style="padding:10px 14px;font-size:11px;font-weight:700;color:${testoHeader};text-align:right;letter-spacing:1px;text-transform:uppercase">Totale</th>
          </tr>
        </thead>
        <tbody>${righe}</tbody>
      </table>`
  }

  function riepilogoTotali(align, fontFamily, coloreTesto, coloreAccento, sfondo) {
    if (!p.totale && !p.imponibile) return ''
    return `
      <div style="display:flex;justify-content:${align};margin-top:8px">
        <div style="background:${sfondo};border-radius:8px;padding:16px 20px;min-width:220px;font-family:${fontFamily}">
          ${p.imponibile ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:${coloreTesto};margin-bottom:6px"><span>Imponibile</span><span>${p.imponibile}</span></div>` : ''}
          ${p.iva ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:${coloreTesto};margin-bottom:10px"><span>${p.iva.split(':')[0]}</span><span>${p.iva.split(':')[1]?.trim() || ''}</span></div>` : ''}
          ${p.totale ? `<div style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;color:${coloreAccento};border-top:1px solid ${coloreTesto}20;padding-top:8px"><span>TOTALE</span><span>${p.totale}</span></div>` : ''}
        </div>
      </div>`
  }

  const templates = {

    pulito: `
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', Arial, sans-serif; padding: 48px; color: #1a1a2e; background: #fff; font-size: 13px; line-height: 1.6; }
      </style>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:36px;padding-bottom:24px;border-bottom:2px solid ${coloreHex}">
        <div>
          ${logoHtml ? `<div style="margin-bottom:10px">${logoHtml}</div>` : ''}
          <div style="font-size:20px;font-weight:700;color:${coloreHex};letter-spacing:-0.5px">${nome}</div>
          <div style="font-size:11px;color:#888;margin-top:4px;line-height:1.8">${citta}${piva ? ' · P.IVA ' + piva : ''}${telefono ? ' · ' + telefono : ''}</div>
        </div>
        <div style="text-align:right;font-size:11px;color:#888;line-height:1.8">
          <div style="font-size:22px;font-weight:700;color:${coloreHex};letter-spacing:-0.5px;margin-bottom:6px">PREVENTIVO</div>
          <div>Data: <strong>${data}</strong></div>
          <div>Validità: ${p.validita || '30 giorni'}</div>
        </div>
      </div>
      ${p.problema ? `<div style="background:#f8f9fa;border-left:3px solid ${coloreHex};padding:12px 16px;border-radius:0 6px 6px 0;margin-bottom:24px;font-size:13px;color:#444">${p.problema}</div>` : ''}
      ${tabellaVoci(coloreHex, '#fff', '#fff', '#f8f9fa', '#1a1a2e', '#666', "'Inter', Arial, sans-serif")}
      ${riepilogoTotali('flex-end', "'Inter', Arial, sans-serif", '#666', coloreHex, '#f8f9fa')}
      ${p.note ? `<div style="margin-top:24px;padding:12px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:12px;color:#92400e"><strong>Note:</strong> ${p.note}</div>` : ''}
      <div style="margin-top:36px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#aaa;display:flex;justify-content:space-between">
        <span>${nome}${citta ? ' · ' + citta : ''}</span>
        <span>Documento generato il ${data}</span>
      </div>`,

    classico: `
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Source+Serif+4:wght@300;400;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Source Serif 4', Georgia, serif; padding: 48px; color: #1a1a1a; background: #fff; }
      </style>
      <div style="text-align:center;border:2px solid ${coloreHex};padding:24px;margin-bottom:32px;border-radius:4px">
        ${logoHtml ? `<div style="margin-bottom:12px">${logoHtml}</div>` : ''}
        <div style="font-family:'Playfair Display',Georgia,serif;font-size:24px;font-weight:700;color:${coloreHex}">${nome}</div>
        <div style="font-size:11px;color:#666;margin-top:6px">${citta}${piva ? ' · P.IVA ' + piva : ''}${telefono ? ' · ' + telefono : ''}</div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:28px">
        <div style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:700;color:${coloreHex};letter-spacing:2px;text-transform:uppercase;border-bottom:2px solid ${coloreHex};padding-bottom:6px">Preventivo</div>
        <div style="text-align:right;font-size:11px;color:#666;line-height:1.9">Data: ${data}<br>Validità: ${p.validita || '30 giorni'}</div>
      </div>
      ${p.problema ? `<div style="font-style:italic;color:#555;margin-bottom:20px;font-size:13px;padding:10px 0;border-bottom:1px solid #eee">${p.problema}</div>` : ''}
      ${tabellaVoci(coloreHex, '#fff', '#fff', '#fafafa', '#1a1a1a', '#555', "'Source Serif 4', Georgia, serif")}
      ${riepilogoTotali('flex-end', "'Source Serif 4', Georgia, serif", '#555', coloreHex, '#f9f9f9')}
      ${p.note ? `<div style="margin-top:20px;font-size:12px;color:#666;font-style:italic"><strong>Note:</strong> ${p.note}</div>` : ''}
      <div style="margin-top:36px;text-align:center;font-size:11px;color:#999;border-top:1px solid #ddd;padding-top:12px;font-style:italic">${nome} · ${citta} · Validità 30 giorni</div>`,

    bold: `
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Montserrat', Arial, sans-serif; margin: 0; padding: 0; color: #1a1a1a; background: #fff; }
      </style>
      <div style="background:${coloreHex};padding:36px 48px;margin-bottom:0">
        ${logoHtml ? `<div style="margin-bottom:12px;filter:brightness(0) invert(1)">${logoHtml}</div>` : ''}
        <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-1px">${nome}</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-top:4px">${citta}${piva ? ' · P.IVA ' + piva : ''}${telefono ? ' · ' + telefono : ''}</div>
      </div>
      <div style="background:#f8f9fa;padding:20px 48px;display:flex;justify-content:space-between;align-items:center;margin-bottom:32px">
        <div style="font-size:22px;font-weight:800;color:${coloreHex};text-transform:uppercase;letter-spacing:1px">Preventivo</div>
        <div style="font-size:11px;color:#666;text-align:right;line-height:1.8">Data: <strong>${data}</strong><br>Validità: ${p.validita || '30 giorni'}</div>
      </div>
      <div style="padding:0 48px">
        ${p.problema ? `<div style="background:${coloreHex}15;border-left:4px solid ${coloreHex};padding:12px 16px;border-radius:0 6px 6px 0;margin-bottom:24px;font-size:13px;font-weight:500;color:#333">${p.problema}</div>` : ''}
        ${tabellaVoci(coloreHex, '#fff', '#fff', '#f8f9fa', '#1a1a1a', '#666', "'Montserrat', Arial, sans-serif")}
        ${riepilogoTotali('flex-end', "'Montserrat', Arial, sans-serif", '#666', coloreHex, `${coloreHex}10`)}
        ${p.note ? `<div style="margin-top:20px;padding:12px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:12px;color:#92400e"><strong>Note:</strong> ${p.note}</div>` : ''}
      </div>
      <div style="margin-top:36px;padding:16px 48px;background:#f8f9fa;font-size:11px;color:#999;display:flex;justify-content:space-between">
        <span>${nome}</span><span>Validità offerta: 30 giorni</span>
      </div>`,

    minimal_dark: `
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', Arial, sans-serif; margin: 0; padding: 0; background: #0d1b2a; color: #e2e8f0; }
      </style>
      <div style="padding:40px 48px;border-bottom:1px solid rgba(255,255,255,0.1)">
        ${logoHtml ? `<div style="margin-bottom:12px;filter:brightness(0) invert(1)">${logoHtml}</div>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:flex-end">
          <div>
            <div style="font-size:20px;font-weight:300;letter-spacing:3px;text-transform:uppercase;color:#fff">${nome}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:4px;letter-spacing:1px">${citta}${piva ? ' · ' + piva : ''}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:18px;font-weight:600;color:#0e9f8e;letter-spacing:2px;text-transform:uppercase">Preventivo</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:4px">${data} · Validità ${p.validita || '30 giorni'}</div>
          </div>
        </div>
      </div>
      <div style="padding:36px 48px;background:#111827">
        ${p.problema ? `<div style="color:rgba(255,255,255,0.6);font-size:13px;margin-bottom:24px;padding:12px 16px;border:1px solid rgba(255,255,255,0.1);border-radius:6px">${p.problema}</div>` : ''}
        <table style="width:100%;border-collapse:collapse;font-family:'Inter',Arial,sans-serif;margin-bottom:20px">
          <thead>
            <tr style="border-bottom:1px solid rgba(255,255,255,0.15)">
              <th style="padding:10px 0;font-size:10px;font-weight:600;color:rgba(255,255,255,0.35);text-align:left;letter-spacing:2px;text-transform:uppercase">DESCRIZIONE</th>
              <th style="padding:10px 0;font-size:10px;font-weight:600;color:rgba(255,255,255,0.35);text-align:right;letter-spacing:2px;text-transform:uppercase">PREZZO</th>
              <th style="padding:10px 0;font-size:10px;font-weight:600;color:rgba(255,255,255,0.35);text-align:right;letter-spacing:2px;text-transform:uppercase">TOTALE</th>
            </tr>
          </thead>
          <tbody>
            ${p.voci.map(v => `<tr style="border-bottom:1px solid rgba(255,255,255,0.06)"><td style="padding:12px 0;font-size:13px;color:#e2e8f0">${v.nome}</td><td style="padding:12px 0;font-size:13px;color:rgba(255,255,255,0.5);text-align:right">${v.prezzo ? '€'+v.prezzo : ''}</td><td style="padding:12px 0;font-size:13px;color:#0e9f8e;font-weight:600;text-align:right">${v.totale ? '€'+v.totale : ''}</td></tr>`).join('')}
          </tbody>
        </table>
        ${p.totale ? `<div style="display:flex;justify-content:flex-end"><div style="min-width:200px">${p.imponibile ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:6px"><span>Imponibile</span><span>${p.imponibile}</span></div>` : ''}${p.iva ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:10px"><span>${p.iva.split(':')[0]}</span><span>${p.iva.split(':')[1]?.trim()}</span></div>` : ''}<div style="display:flex;justify-content:space-between;font-size:16px;font-weight:600;color:#0e9f8e;border-top:1px solid rgba(255,255,255,0.1);padding-top:10px"><span>TOTALE</span><span>${p.totale}</span></div></div></div>` : ''}
        ${p.note ? `<div style="margin-top:24px;padding:12px 16px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;font-size:12px;color:rgba(255,255,255,0.6)"><strong>Note:</strong> ${p.note}</div>` : ''}
      </div>
      <div style="padding:16px 48px;font-size:10px;color:rgba(255,255,255,0.25);display:flex;justify-content:space-between">
        <span>${telefono || ''}</span><span>Validità 30 giorni</span>
      </div>`,

    artigiano: `
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Lora', Georgia, serif; padding: 48px; color: #2c1810; background: #fdfaf5; }
      </style>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding-bottom:16px;border-bottom:3px double ${coloreHex}">
        <div>
          ${logoHtml ? `<div style="margin-bottom:10px">${logoHtml}</div>` : ''}
          <div style="font-size:22px;font-weight:600;color:${coloreHex};font-style:italic">${nome}</div>
          <div style="font-size:11px;color:#8b6355;margin-top:4px;line-height:1.8">${citta}${piva ? ' · P.IVA ' + piva : ''}${telefono ? '<br>' + telefono : ''}</div>
        </div>
        <div style="text-align:right;font-size:11px;color:#8b6355;line-height:1.8">Data: ${data}<br>Validità: ${p.validita || '30 giorni'}</div>
      </div>
      <div style="font-family:'Lora',Georgia,serif;font-size:18px;font-weight:600;color:${coloreHex};font-style:italic;margin-bottom:20px;text-align:center">~ Preventivo ~</div>
      ${p.problema ? `<div style="font-style:italic;color:#5c3d2e;margin-bottom:20px;padding:12px 16px;border-left:3px solid ${coloreHex};background:#fdf3e7;font-size:13px">${p.problema}</div>` : ''}
      <table style="width:100%;border-collapse:collapse;font-family:'Lora',Georgia,serif;margin-bottom:20px">
        <thead>
          <tr style="background:${coloreHex};color:#fff">
            <th style="padding:10px 14px;font-size:11px;font-weight:600;text-align:left;letter-spacing:1px">Descrizione</th>
            <th style="padding:10px 14px;font-size:11px;font-weight:600;text-align:right;letter-spacing:1px">Prezzo</th>
            <th style="padding:10px 14px;font-size:11px;font-weight:600;text-align:right;letter-spacing:1px">Totale</th>
          </tr>
        </thead>
        <tbody>
          ${p.voci.map((v, i) => `<tr style="background:${i%2===0?'#fff':'#fdf3e7'}"><td style="padding:10px 14px;font-size:13px;color:#2c1810">${v.nome}</td><td style="padding:10px 14px;font-size:13px;color:#8b6355;text-align:right">${v.prezzo?'€'+v.prezzo:''}</td><td style="padding:10px 14px;font-size:13px;font-weight:600;color:${coloreHex};text-align:right">${v.totale?'€'+v.totale:''}</td></tr>`).join('')}
        </tbody>
      </table>
      ${p.totale ? `<div style="display:flex;justify-content:flex-end"><div style="background:#fdf3e7;border:1px solid ${coloreHex}40;border-radius:6px;padding:14px 18px;min-width:200px">${p.imponibile?`<div style="display:flex;justify-content:space-between;font-size:12px;color:#8b6355;margin-bottom:6px"><span>Imponibile</span><span>${p.imponibile}</span></div>`:''}${p.iva?`<div style="display:flex;justify-content:space-between;font-size:12px;color:#8b6355;margin-bottom:10px"><span>${p.iva.split(':')[0]}</span><span>${p.iva.split(':')[1]?.trim()}</span></div>`:''}<div style="display:flex;justify-content:space-between;font-size:15px;font-weight:600;color:${coloreHex};border-top:1px solid ${coloreHex}40;padding-top:8px;font-style:italic"><span>Totale</span><span>${p.totale}</span></div></div></div>` : ''}
      ${p.note ? `<div style="margin-top:20px;padding:12px 16px;background:#fdf3e7;border:1px dashed ${coloreHex}80;border-radius:6px;font-size:12px;color:#5c3d2e;font-style:italic"><strong>Note:</strong> ${p.note}</div>` : ''}
      <div style="margin-top:36px;padding-top:14px;border-top:3px double ${coloreHex};font-size:11px;color:#8b6355;text-align:center;font-style:italic">"La qualità del lavoro ben fatto" · ${nome}</div>`
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body>${templates[template] || templates.pulito}</body></html>`
}