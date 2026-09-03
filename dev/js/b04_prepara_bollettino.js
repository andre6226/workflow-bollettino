// ============================================================================
// PREPARA BOLLETTINO UFFICIALE
// ============================================================================
// Prende la riga letta dalla Data table (una per regione, scritta dal workflow
// "Aggiorna Bollettini Ufficiali") e la adatta alla città richiesta:
//
//  - rigenera il testo `clean` tenendo SOLO il riferimento della città
//    (per Torino la sigla TO, non tutte e otto le province: sono token sprecati
//    che confondono il modello)
//  - valuta la freschezza: oltre `ore_max_bollettino` la mail lo segnala
//  - se la riga manca si prosegue coi soli modelli, senza bloccare la mail
// ============================================================================

const cfg = $('0. Config').first().json;
const richiesta = $('Risolvi Località').first().json;
const citta = richiesta.citta;

const riga = $input.first().json || {};

const esito = {
  ...richiesta,
  ufficiale_ok: false,
  ufficiale_nome: null,
  ufficiale_numero: null,
  ufficiale_emissione: null,
  ufficiale_by_date: {},
  ufficiale_tendenza: {},
  ufficiale_clean: '(fonte ufficiale non disponibile in questa esecuzione)',
  ufficiale_nota: ''
};

let doc = null;
try {
  if (riga.testo_bollettino) doc = JSON.parse(riga.testo_bollettino);
} catch (e) {
  esito.ufficiale_nota = 'Riga bollettino illeggibile: bollettino basato sui soli modelli numerici.';
}

if (!doc) {
  if (!esito.ufficiale_nota) {
    esito.ufficiale_nota = `Nessun bollettino ufficiale in tabella per "${citta.regione}": previsione basata sui soli modelli numerici.`;
  }
  return [{ json: esito }];
}

esito.ufficiale_ok = Boolean(doc.ok);
esito.ufficiale_nome = doc.provider === 'arpal' ? 'ARPAL Liguria' : 'ARPA Piemonte';
esito.ufficiale_numero = doc.bollettino || null;
esito.ufficiale_emissione = doc.emissione || null;
esito.ufficiale_by_date = doc.by_date || {};
esito.ufficiale_tendenza = doc.tendenza || {};

// --- freschezza -------------------------------------------------------------
// updatedAt lo mantiene n8n sulla riga; se manca si usa il recuperato_il che
// scrive il parser.
const quando = riga.updatedAt || riga.createdAt || doc.recuperato_il;
if (quando) {
  const ore = (Date.now() - new Date(quando).getTime()) / 3600000;
  esito.ufficiale_ore = Math.round(ore);
  if (ore > (cfg.ore_max_bollettino || 30)) {
    esito.ufficiale_nota = `Bollettino ufficiale non aggiornato da ${Math.round(ore)} h (emissione ${doc.emissione || 'n/d'}).`;
  }
}

// --- testo su misura per la città ------------------------------------------
// Dei riferimenti ufficiali si tiene solo quello della località (più lo zero
// termico, che vale per tutta la regione).
function rifDellaCitta(rif) {
  if (!rif) return '';
  const pezzi = [];
  const mio = rif[citta.rif];
  if (mio && typeof mio === 'object' && 'min' in mio) {
    pezzi.push(`${citta.rif}: ${mio.min}/${mio.max} °C${mio.prob_prec ? ` (prob. prec. ${mio.prob_prec})` : ''}`);
  }
  // Fasce di quota: utili solo dove la quota conta davvero.
  if (citta.profilo === 'montagna' || citta.profilo === 'fondovalle') {
    ['quota_700m', 'quota_1500m', 'quota_2000m'].forEach(k => {
      const v = rif[k];
      if (v && 'min' in v) pezzi.push(`${k.replace('quota_', '').replace('m', ' m')}: ${v.min}/${v.max} °C`);
    });
  }
  if (rif.zero_termico_m) pezzi.push(`zero termico ${rif.zero_termico_m} m`);
  return pezzi.join(' | ');
}

const parti = [
  `BOLLETTINO ${esito.ufficiale_nome} ${doc.bollettino || ''} — emissione ${doc.emissione || 'n/d'}`
];
if (doc.situazione) parti.push(`\nSITUAZIONE ED EVOLUZIONE:\n${doc.situazione}`);

Object.entries(doc.by_date || {}).forEach(([iso, d]) => {
  const rif = rifDellaCitta((doc.rif_localita || {})[iso]);
  parti.push([
    `\n--- ${iso} (${d.etichetta}) — attendibilità dichiarata: ${d.affidabilita || 'n/d'} ---`,
    d.cielo ? `CIELO E FENOMENI: ${d.cielo}` : null,
    d.venti ? `VENTI: ${d.venti}` : null,
    // Il mare interessa solo la costa; lo zero termico solo quota e fondovalle.
    (d.mare && citta.profilo === 'costa') ? `MARE: ${d.mare}` : null,
    (d.zero_termico && citta.profilo !== 'costa') ? `ZERO TERMICO: ${d.zero_termico}` : null,
    d.temperature ? `TENDENZA TERMICA: ${d.temperature}` : null,
    d.umidita ? `UMIDITÀ: ${d.umidita}` : null,
    d.segnalazioni ? `SEGNALAZIONI PROT. CIVILE: ${d.segnalazioni}` : null,
    rif ? `RIFERIMENTI UFFICIALI (${citta.nome}): ${rif}` : null
  ].filter(Boolean).join('\n'));
});

const tend = Object.entries(doc.tendenza || {});
if (tend.length) {
  parti.push('\n--- TENDENZA (giorni successivi, bassa risoluzione) ---');
  tend.forEach(([iso, t]) => {
    parti.push(`${iso}: ${t.previsioni} | temp: ${t.temperature} | venti: ${t.venti}${t.zero_termico ? ` | zero termico: ${t.zero_termico}` : ''} | attendibilità: ${t.affidabilita}`);
  });
}

esito.ufficiale_clean = parti.join('\n').trim();

return [{ json: esito }];
