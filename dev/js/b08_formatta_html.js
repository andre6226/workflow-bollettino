// ============================================================================
// FORMATTA HTML (+ versione testuale)
// ============================================================================
// La quarta casella cambia secondo il profilo della località:
//   costa      -> 🌊 Mare
//   pianura    -> 🌫️ Visibilità
//   montagna   -> 🏔️ Zero termico e neve
//   fondovalle -> 🏔️ Zero termico e neve
// ============================================================================

const src = $input.first().json;
const f = src.forecast || {};
const meta = src.meta || {};

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const num = (v, unita = '', dec = 0) =>
  (v === null || v === undefined || v === '' || Number.isNaN(Number(v)))
    ? 'n/d' : `${Number(v).toFixed(dec)}${unita}`;

const piccolo = t => `<br><span style="font-size:9.5px;font-weight:500;color:#64748b;">${t}</span>`;

// --- quarta casella, dipendente dal profilo --------------------------------
function quartaCasella(g) {
  if (f.riquadro === 'neve') {
    const zt = (g.zero_termico_min != null && g.zero_termico_max != null)
      ? `${Math.round(g.zero_termico_min / 10) * 10}–${Math.round(g.zero_termico_max / 10) * 10} m`
      : 'n/d';
    const neve = g.neve_cm > 0
      ? `neve ${num(g.neve_cm, ' cm', 1)}`
      : (g.neve_al_suolo_cm > 0 ? `manto ${num(g.neve_al_suolo_cm, ' cm')}` : 'niente neve');
    return { bg: '#eef2ff', bd: '#c7d2fe', fg: '#4338ca', tit: '🏔️ Zero term.', val: `${zt}${piccolo(neve)}` };
  }
  if (f.riquadro === 'visibilita') {
    const vis = g.vis_min != null
      ? (g.vis_min >= 1000 ? `${(g.vis_min / 1000).toFixed(1)} km` : `${Math.round(g.vis_min)} m`)
      : 'n/d';
    const nota = g.nebbia ? `nebbia ${esc(g.nebbia)}` : (g.foschia ? `foschia ${esc(g.foschia)}` : 'buona');
    return { bg: '#f5f3ff', bd: '#ddd6fe', fg: '#6d28d9', tit: '🌫️ Visibilità', val: `${vis}${piccolo(nota)}` };
  }
  return { bg: '#f0fdf4', bd: '#bbf7d0', fg: '#15803d', tit: '🌊 Mare', val: esc(g.mare || 'Non disponibile') };
}

function boxPioggia(g) {
  const tot = num(g.pioggia_mm, ' mm', 1);
  if (!g.pioggia_mm) return `${tot}${piccolo(`prob. ${num(g.prob_pioggia, '%')}`)}`;
  return `${tot}${piccolo(`max ${num(g.pioggia_max_h, ' mm/h', 1)} · prob. ${num(g.prob_pioggia, '%')}`)}`;
}

function statsTableHtml(g) {
  const celle = [
    { bg: '#f0f9ff', bd: '#bae6fd', fg: '#0369a1', tit: '🌡️ Temp',
      val: `${num(g.tmin, '°', 1)} / ${num(g.tmax, '°C', 1)}${piccolo(`perc. ${num(g.perc_min, '°', 1)} / ${num(g.perc_max, '°C', 1)}`)}` },
    { bg: '#f0fdfa', bd: '#99f6e4', fg: '#0f766e', tit: '🌧️ Pioggia', val: boxPioggia(g) },
    { bg: '#f8fafc', bd: '#e2e8f0', fg: '#475569', tit: '💨 Vento',
      val: `${esc(g.vento_dir)} ${num(g.vento_kmh, ' km/h')}${piccolo(`raff. ${num(g.raffiche_kmh, ' km/h')}${g.finestra_vento ? ` · ${esc(g.finestra_vento)}` : ''}`)}` },
    quartaCasella(g)
  ];

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px; border-collapse:separate; border-spacing:4px 0;">
      <tr>${celle.map(c => `
        <td width="25%" valign="top" style="background:${c.bg}; border:1px solid ${c.bd}; border-radius:6px; padding:6px 3px; text-align:center;">
          <div style="font-size:9.5px; font-weight:700; color:${c.fg}; text-transform:uppercase; margin-bottom:2px;">${c.tit}</div>
          <div style="font-size:10.5px; font-weight:600; color:#0f172a; line-height:1.3;">${c.val}</div>
        </td>`).join('')}
      </tr>
    </table>`;
}

// Riga di sintesi: cielo, umidità e i fenomeni locali effettivamente attivi.
function rigaSintesi(g) {
  const pezzi = [`Cielo: ${esc(g.cielo)}`];
  if (g.nuvolosita != null) pezzi.push(`copertura ${num(g.nuvolosita, '%')}`);
  if (g.umidita != null) pezzi.push(`UR ${num(g.umidita, '%')}`);
  if (g.finestra_pioggia) pezzi.push(`fenomeni ore ${esc(g.finestra_pioggia)}`);
  if (g.convezione && g.convezione !== 'assente') pezzi.push(`convezione ${esc(g.convezione)}`);
  if (g.foehn) pezzi.push(`foehn ${esc(g.foehn)}`);
  if (g.inversione) pezzi.push(`inversione ${esc(g.inversione)}`);
  return `<div style="font-size:11px; color:#64748b; margin-top:8px;">${pezzi.join(' · ')}</div>`;
}

const cronoHtml = (f.giorni || []).map(g => `
      <div style="background:#ffffff; border:1px solid #e2e8f0; border-left:4px solid #0284c7; padding:12px 14px; margin-bottom:12px; border-radius:0 8px 8px 0; font-size:13px; line-height:1.55; color:#334155;">
        <strong style="color:#0f172a;">${esc(g.titolo)}:</strong> ${esc(g.descrizione)}
        ${rigaSintesi(g)}
        ${statsTableHtml(g)}
      </div>`).join('');

const fonte = meta.bollettino
  ? `Fonte ufficiale: ${esc(meta.fonte)}, bollettino n° ${esc(meta.bollettino)} (emissione ${esc(meta.emissione || 'n/d')}).`
  : 'Fonte ufficiale non disponibile in questa esecuzione.';

const avvisiHtml = (meta.avvisi || []).length
  ? `<div style="max-width:620px;margin:0 auto 18px auto;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;color:#991b1b;font-size:11.5px;line-height:1.5;">
       <strong>Note di elaborazione:</strong> ${esc((meta.avvisi || []).join(' · '))}
     </div>` : '';

const fullEmailHtml = `
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bollettino Meteo — ${esc(f.citta)}</title>
</head>
<body style="margin:0; padding:20px 10px; background-color:#f1f5f9; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="max-width:620px; margin:0 auto;">
    <div style="text-align:center; margin-bottom:22px;">
      <h1 style="color:#0f172a; font-size:20px; font-weight:800; margin:0 0 4px 0; letter-spacing:-0.3px;">🌤️ Bollettino meteorologico</h1>
      <div style="color:#64748b; font-size:12.5px; font-weight:500;">${esc(f.citta)} · ${num(meta.quota, ' m s.l.m.')} · ${(meta.giorni || []).length} giorni</div>
    </div>
    ${avvisiHtml}
    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:12px; margin-bottom:28px; overflow:hidden; box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);">
      <div style="background:linear-gradient(135deg, #0284c7, #0369a1); padding:14px 18px; color:#ffffff;">
        <h2 style="margin:0; font-size:17px; font-weight:700; letter-spacing:0.3px;">📍 ${esc(String(f.citta || '').toUpperCase())}</h2>
      </div>
      <div style="padding:18px;">
        <div style="margin-bottom:18px;">
          <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:#0284c7; letter-spacing:0.5px; margin-bottom:4px;">Dinamica delle masse d'aria</div>
          <p style="margin:0; font-size:13.5px; line-height:1.6; color:#334155;">${esc(f.quadro_generale)}</p>
        </div>
        <div style="margin-bottom:18px;">
          <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:#0284c7; letter-spacing:0.5px; margin-bottom:8px;">Cronologia giorno per giorno</div>
          ${cronoHtml}
        </div>
        <div style="background:#fffbeb; border:1px solid #fef3c7; border-left:4px solid #f59e0b; border-radius:6px; padding:10px 14px; font-size:12.5px; line-height:1.5; color:#92400e;">
          <div style="font-weight:700; margin-bottom:3px; color:#b45309;">⚖️ Confronto modelli vs fonte ufficiale</div>
          <strong style="color:#0f172a;">Confidenza ${esc(f.confidenza || 'N/D')}:</strong> ${esc(f.confronto_ufficiale)}
        </div>
      </div>
    </div>
    <div style="text-align:center; color:#94a3b8; font-size:11px; line-height:1.5; margin-top:20px;">
      Elaborazione automatica: AROME HD / ICON-D2 / ICON-2I / ECMWF IFS / GFS.<br>
      ${fonte}<br>
      I valori numerici sono calcolati da script, non generati dal modello linguistico.
    </div>
  </div>
</body>
</html>`;

// --- versione solo testo ----------------------------------------------------
const righe = [`BOLLETTINO METEO — ${f.citta}`, fonte, ''];
righe.push(f.quadro_generale || '');
(f.giorni || []).forEach(g => {
  righe.push('', `${g.titolo}: ${g.descrizione}`);
  const parti = [
    `Temp ${num(g.tmin, '', 1)}/${num(g.tmax, '°C', 1)} (perc. ${num(g.perc_min, '', 1)}/${num(g.perc_max, '°C', 1)})`,
    `Pioggia ${num(g.pioggia_mm, ' mm', 1)} (prob. ${num(g.prob_pioggia, '%')})`,
    `Vento ${g.vento_dir} ${num(g.vento_kmh, ' km/h')} raff. ${num(g.raffiche_kmh, ' km/h')}`
  ];
  if (f.riquadro === 'mare') parti.push(`Mare: ${g.mare}`);
  if (f.riquadro === 'neve') parti.push(`Zero termico ${num(g.zero_termico_min, '', 0)}–${num(g.zero_termico_max, ' m', 0)}, neve ${num(g.neve_cm, ' cm', 1)}`);
  if (f.riquadro === 'visibilita') parti.push(`Visibilità min ${num(g.vis_min, ' m')}${g.nebbia ? ` (nebbia ${g.nebbia})` : ''}`);
  righe.push('  ' + parti.join(' · '));
});
righe.push('', `Confidenza ${f.confidenza}: ${f.confronto_ufficiale || ''}`);
if ((meta.avvisi || []).length) righe.push('', 'Note: ' + meta.avvisi.join(' · '));

return [{
  json: {
    html: fullEmailHtml,
    text: righe.join('\n'),
    citta: f.citta,
    emails: src.emails,
    chat_id: src.chat_id,
    meta
  }
}];
