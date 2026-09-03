// ============================================================================
// PARSER BOLLETTINO UFFICIALE (ARPAL Liguria / ARPA Piemonte)
// ============================================================================
// I due PDF sono impaginati diversamente ma condividono la stessa forma logica:
// intestazioni di giorno + righe etichettate + una tabella di temperature per
// località. Il motore a righe è comune, cambiano solo le etichette e il modo
// di leggere la tabella.
//
// Nota sui PDF:
//  - ARPAL serve un corpo multipart/form-data salvato su disco: il "%PDF" vero
//    comincia al byte 131. Funziona perché i parser accettano l'header entro i
//    primi 1024 byte, ma è fragile: se un giorno l'estrazione smette di
//    funzionare senza motivo, la causa è quella.
//  - ARPA Piemonte è un PDF pulito, con 84 h di validità (3 giorni estesi + la
//    tendenza del quarto).
//
// L'output è un JSON unico per entrambi i provider, salvato come stringa nella
// colonna testo_bollettino della Data table.
// ============================================================================

// Gli item arrivano da "Estrai Testo PDF", che e' 1:1 con l'input: si
// riabbinano per indice ai metadati di "Filtra e Riabbina" (regione, provider,
// bollettino gia' salvato). Niente dipendenze da pairedItem o da come il nodo
// di estrazione tratta il json.

const MESI = {
  gennaio: '01', febbraio: '02', marzo: '03', aprile: '04', maggio: '05', giugno: '06',
  luglio: '07', agosto: '08', settembre: '09', ottobre: '10', novembre: '11', dicembre: '12'
};

function analizza(meta, testoGrezzo) {
const provider = meta.provider;
const regione = meta.regione;
const raw = String(testoGrezzo || '');
const lastModified = meta.last_modified || null;
const precedente = meta.precedente || null; // JSON gia' salvato, per la guardia

const out = {
  regione,
  provider,
  ok: false,
  bollettino: null,
  emissione: null,
  last_modified: lastModified,
  recuperato_il: new Date().toISOString(),
  situazione: '',
  by_date: {},
  tendenza: {},
  rif_localita: {},
  clean: '',
  nota: ''
};

if (!raw.trim()) {
  out.nota = 'PDF vuoto o non estraibile.';
  out.clean = '(fonte ufficiale non disponibile)';
  return { out, cambiato: false };
}

const lines = raw.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim());
const nonVuote = lines.filter(Boolean);

// ---------------------------------------------------------------------------
// Estrattore di sezioni etichettate, comune ai due provider.
// Raccoglie le righe di continuazione (i PDF mandano a capo a metà frase)
// fermandosi alla prossima etichetta, a una riga vuota o a rumore tabellare.
// ---------------------------------------------------------------------------
function sezioni(blocco, reEtichette, reRumore) {
  const sez = {};
  let corrente = null;
  for (const line of blocco) {
    const m = line.match(reEtichette);
    if (m) {
      corrente = m[1].toUpperCase().replace('UMIDITA', 'UMIDITÀ').replace('NUVOLOSITA', 'NUVOLOSITÀ');
      sez[corrente] = m[2].trim();
      continue;
    }
    if (corrente && line && !reRumore.test(line) && !/^\d+([.,]\d+)?$|^[<>-]|^0°/.test(line)) {
      sez[corrente] += ' ' + line;
      continue;
    }
    if (!line) corrente = null;
  }
  return sez;
}

function isoDa(giorno, meseNome, anno) {
  const mese = MESI[String(meseNome).toLowerCase()];
  if (!mese) return null;
  return `${anno}-${mese}-${String(giorno).padStart(2, '0')}`;
}

// ===========================================================================
// PROVIDER: ARPAL Liguria
// ===========================================================================
function parseArpal() {
  const ETICHETTE = /^(CIELO E FENOMENI|VENTI|MARE|TEMPERATURE|UMIDIT[AÀ]|SEGNALAZIONI[^:]*)\s*:\s*(.*)$/i;
  const RUMORE = /^(IL TEMPO|TEMP\.|CLIMA|PROBABILIT|A \.\.\.|MIN|MAX|PRECIPITAZIONI|BOLLETTINO|CENTRO FUNZIONALE|DI PROTEZIONE CIVILE|DATA EMISSIONE|VALIDIT|PROSSIMO AGGIORNAMENTO|ARPAL Via Bombrini|AgenziaArpal|ARPALiguria|\d+\/\d+$)/i;
  const CITTA = ['Imperia', 'Savona', 'Genova', 'Chiavari', 'La Spezia', 'Pieve Di Teco', 'Cairo Montenotte', 'Busalla', 'Varese Ligure'];
  // Località di riferimento usate dalle città configurate nel bollettino
  const RIF = ['Imperia', 'Genova'];

  const mBoll = raw.match(/(\d{1,4}\/\d{4})/);
  if (mBoll) out.bollettino = mBoll[1];
  const mEmi = raw.match(/(\d{1,2}\s+[A-Za-zÀ-ÿ]+\s+\d{4},\s*\d{1,2}:\d{2})/);
  if (mEmi) out.emissione = mEmi[1];

  // Intestazioni giorno: "Martedì 01 Settembre 2026" (senza orario: i timbri di
  // emissione e aggiornamento hanno lo stesso formato ma finiscono con hh:mm)
  const reGiorno = /^(luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica)\s+(\d{1,2})\s+([a-zà-ÿ]+)\s+(\d{4})/i;
  const giorni = [];
  lines.forEach((line, idx) => {
    if (/\d{1,2}:\d{2}/.test(line)) return;
    const m = line.match(reGiorno);
    if (!m) return;
    const iso = isoDa(m[2], m[3], m[4]);
    if (iso) giorni.push({ idx, iso, etichetta: line });
  });

  giorni.forEach((g, i) => {
    const fine = i + 1 < giorni.length ? giorni[i + 1].idx : lines.length;
    const blocco = lines.slice(g.idx, fine);
    const sez = sezioni(blocco, ETICHETTE, RUMORE);
    const aff = blocco.join(' ').match(/affidabilit[aà]\s+(alta|media|bassa)/i);

    out.by_date[g.iso] = {
      etichetta: g.etichetta,
      cielo: (sez['CIELO E FENOMENI'] || '').trim(),
      venti: (sez['VENTI'] || '').trim(),
      mare: (sez['MARE'] || '').trim(),
      temperature: (sez['TEMPERATURE'] || '').trim(),
      umidita: (sez['UMIDITÀ'] || '').trim(),
      segnalazioni: (sez['SEGNALAZIONI PROTEZIONE CIVILE'] || '').trim(),
      affidabilita: aff ? aff[1].toLowerCase() : '',
      zero_termico: ''
    };
  });

  // Situazione sinottica (compare una sola volta, sul primo giorno)
  const iSit = lines.findIndex(l => /^SITUAZIONE ED EVOLUZIONE/i.test(l));
  if (iSit !== -1) {
    const buf = [];
    for (let i = iSit + 1; i < lines.length; i++) {
      const l = lines[i];
      if (ETICHETTE.test(l)) break;
      if (!l || RUMORE.test(l) || /^\d+([.,]\d+)?$|^[<>-]/.test(l)) continue;
      if (l.length < 12) continue;
      buf.push(l);
    }
    out.situazione = buf.join(' ').trim();
  }

  // Tabella temperature: nell'ordine dello stream, <città> <min> <max> <climaMin> <climaMax> <prob>
  const gruppi = [];
  let corrente = null;
  nonVuote.forEach(t => {
    if (CITTA.includes(t)) {
      if (t === CITTA[0]) { corrente = {}; gruppi.push(corrente); }
      if (corrente) corrente._c = t;
      return;
    }
    if (corrente && corrente._c) {
      corrente[corrente._c] = corrente[corrente._c] || [];
      if (corrente[corrente._c].length < 5) corrente[corrente._c].push(t);
    }
  });
  gruppi.forEach((g, i) => {
    const iso = giorni[i]?.iso;
    if (!iso) return;
    const r = {};
    RIF.forEach(c => {
      const v = g[c] || [];
      const min = Number(v[0]), max = Number(v[1]);
      if (Number.isFinite(min) && Number.isFinite(max)) r[c] = { min, max, prob_prec: v[4] || '' };
    });
    if (Object.keys(r).length) out.rif_localita[iso] = r;
  });

  // Tabella "Tendenza": date in colonna, poi i valori a gruppi di 4
  const iTend = lines.findIndex(l => /^Tendenza$/i.test(l));
  if (iTend !== -1) {
    const coda = lines.slice(iTend).filter(Boolean);
    const date = [];
    coda.forEach(l => {
      const m = l.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) date.push(`${m[3]}-${m[2]}-${m[1]}`);
    });
    const iAff = coda.findIndex(l => /^AFFIDABILIT[AÀ]$/i.test(l));
    if (iAff !== -1 && date.length) {
      const valori = coda.slice(iAff + 1).filter(l =>
        !/^ARPAL Via Bombrini|^AgenziaArpal|^ARPALiguria|^\d+\/\d+$/i.test(l));
      date.forEach((iso, i) => {
        const b = valori.slice(i * 4, i * 4 + 4);
        if (b.length === 4) {
          out.tendenza[iso] = { previsioni: b[0], temperature: b[1], venti: b[2], affidabilita: b[3] };
        }
      });
    }
  }
}

// ===========================================================================
// PROVIDER: ARPA Piemonte
// ===========================================================================
function parseArpaPiemonte() {
  const ETICHETTE = /^(NUVOLOSIT[AÀ]|PRECIPITAZIONI|ZERO TERMICO|VENTI|TEMPERATURE)\s*:\s*(.*)$/i;
  const RUMORE = /^(Bollettino Meteo|BOLLETTINO N|DATA EMISSIONE|VALIDIT|AGGIORNAMENTO|SERVIZIO A CURA|AMBITO|Dipartimento|Regione Piemonte|Notte\/Mattina|Pomeriggio\/Sera|°C Min Max|Attendibilit)/i;
  // Sigle delle province + le fasce di quota della tabella
  const SIGLE = ['AL', 'AT', 'BI', 'CN', 'NO', 'TO', 'VB', 'VC'];
  const QUOTE = ['700', '1500', '2000'];

  const mBoll = raw.match(/(\d{1,4}\/\d{4})/);
  if (mBoll) out.bollettino = mBoll[1];
  const mEmi = raw.match(/(\d{2}\/\d{2}\/\d{4}\s+ore\s+\d{1,2}:\d{2})/i);
  if (mEmi) out.emissione = mEmi[1];

  // Intestazioni giorno: "martedì, 01 settembre 2026" (minuscolo, con virgola)
  const reGiorno = /^(luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica),\s*(\d{1,2})\s+([a-zà-ÿ]+)\s+(\d{4})/i;
  const reTendenza = /^Tendenza per\s+(luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica),\s*(\d{1,2})\s+([a-zà-ÿ]+)\s+(\d{4})/i;

  const giorni = [];
  let idxTendenza = -1;
  let isoTendenza = null;

  lines.forEach((line, idx) => {
    const t = line.match(reTendenza);
    if (t) {
      idxTendenza = idx;
      isoTendenza = isoDa(t[2], t[3], t[4]);
      return;
    }
    const m = line.match(reGiorno);
    if (!m) return;
    const iso = isoDa(m[2], m[3], m[4]);
    if (iso) giorni.push({ idx, iso, etichetta: line });
  });

  const fineEstesa = idxTendenza !== -1 ? idxTendenza : lines.length;

  giorni.forEach((g, i) => {
    const fine = i + 1 < giorni.length ? giorni[i + 1].idx : fineEstesa;
    const blocco = lines.slice(g.idx, fine);
    const sez = sezioni(blocco, ETICHETTE, RUMORE);
    // Qui l'attendibilità è un numero: "Attendibilità: 95%"
    const att = blocco.join(' ').match(/attendibilit[aà]\s*:?\s*(\d{1,3})\s*%/i);

    out.by_date[g.iso] = {
      etichetta: g.etichetta,
      cielo: (sez['NUVOLOSITÀ'] || '').trim(),
      precipitazioni: (sez['PRECIPITAZIONI'] || '').trim(),
      venti: (sez['VENTI'] || '').trim(),
      zero_termico: (sez['ZERO TERMICO'] || '').trim(),
      temperature: (sez['TEMPERATURE'] || '').trim(),
      mare: '', // il Piemonte non ha costa
      umidita: '',
      segnalazioni: '',
      affidabilita: att ? `${att[1]}%` : ''
    };
    // Il campo "cielo" per l'Agente Capo unisce nuvolosità e precipitazioni:
    // ARPAL le tiene su una riga sola, qui sono separate.
    const p = out.by_date[g.iso].precipitazioni;
    if (p) out.by_date[g.iso].cielo = [out.by_date[g.iso].cielo, `Precipitazioni: ${p}`].filter(Boolean).join(' ');
  });

  // Situazione sinottica: paragrafo dopo "Situazione ed evoluzione"
  const iSit = lines.findIndex(l => /^Situazione ed evoluzione/i.test(l));
  if (iSit !== -1) {
    const buf = [];
    for (let i = iSit + 1; i < lines.length; i++) {
      const l = lines[i];
      if (reGiorno.test(l) || ETICHETTE.test(l)) break;
      if (!l || RUMORE.test(l)) continue;
      if (l.length < 12) continue;
      buf.push(l);
    }
    out.situazione = buf.join(' ').trim();
  }

  // Tabella temperature: blocchi "°C Min Max" seguiti da <sigla> <min> <max>,
  // poi le fasce di quota e "0° NNNNm".
  const blocchiTab = [];
  let corrente = null;
  nonVuote.forEach(t => {
    if (/^°C Min Max$/i.test(t)) { corrente = { valori: {}, quote: {}, zero: null }; blocchiTab.push(corrente); return; }
    if (!corrente) return;
    const mZero = t.match(/^0°\s*(\d{3,4})\s*m$/i);
    if (mZero) { corrente.zero = Number(mZero[1]); return; }
    const m = t.match(/^([A-Z]{2}|700|1500|2000)\s+(-?\d{1,2})\s+(-?\d{1,2})$/);
    if (!m) return;
    const chiave = m[1];
    const rec = { min: Number(m[2]), max: Number(m[3]) };
    if (QUOTE.includes(chiave)) corrente.quote[chiave] = rec;
    else if (SIGLE.includes(chiave)) corrente.valori[chiave] = rec;
  });

  blocchiTab.forEach((b, i) => {
    const iso = giorni[i]?.iso;
    if (!iso) return;
    const r = {};
    SIGLE.forEach(s => { if (b.valori[s]) r[s] = b.valori[s]; });
    QUOTE.forEach(q => { if (b.quote[q]) r[`quota_${q}m`] = b.quote[q]; });
    if (b.zero !== null) r.zero_termico_m = b.zero;
    if (Object.keys(r).length) out.rif_localita[iso] = r;
  });

  // Tendenza del quarto giorno: stesse etichette, un blocco solo
  if (idxTendenza !== -1 && isoTendenza) {
    const blocco = lines.slice(idxTendenza);
    const sez = sezioni(blocco, ETICHETTE, RUMORE);
    const att = blocco.join(' ').match(/attendibilit[aà]\s*:?\s*(\d{1,3})\s*%/i);
    const previsioni = [sez['NUVOLOSITÀ'], sez['PRECIPITAZIONI'] ? `Precipitazioni: ${sez['PRECIPITAZIONI']}` : '']
      .filter(Boolean).join(' ').trim();
    out.tendenza[isoTendenza] = {
      previsioni,
      temperature: (sez['TEMPERATURE'] || '').trim(),
      venti: (sez['VENTI'] || '').trim(),
      zero_termico: (sez['ZERO TERMICO'] || '').trim(),
      affidabilita: att ? `${att[1]}%` : ''
    };
  }
}

// ===========================================================================
try {
  if (provider === 'arpal') parseArpal();
  else if (provider === 'arpa_piemonte') parseArpaPiemonte();
  else throw new Error(`Provider sconosciuto: ${provider}`);

  out.ok = Object.keys(out.by_date).length > 0;

  // --- testo compatto per il prompt dell'Agente Capo -----------------------
  const etichettaFonte = provider === 'arpal' ? 'ARPAL Liguria' : 'ARPA Piemonte';
  const parti = [`BOLLETTINO ${etichettaFonte} ${out.bollettino || ''} — emissione ${out.emissione || 'n/d'}`];
  if (out.situazione) parti.push(`\nSITUAZIONE ED EVOLUZIONE:\n${out.situazione}`);

  Object.entries(out.by_date).forEach(([iso, d]) => {
    const rif = out.rif_localita[iso] || {};
    const righeRif = Object.entries(rif)
      .map(([k, v]) => (v && typeof v === 'object' && 'min' in v)
        ? `${k}: ${v.min}/${v.max} °C${v.prob_prec ? ` (prob. prec. ${v.prob_prec})` : ''}`
        : (k === 'zero_termico_m' ? `zero termico ${v} m` : null))
      .filter(Boolean).join(' | ');

    parti.push([
      `\n--- ${iso} (${d.etichetta}) — attendibilità dichiarata: ${d.affidabilita || 'n/d'} ---`,
      d.cielo ? `CIELO E FENOMENI: ${d.cielo}` : null,
      d.venti ? `VENTI: ${d.venti}` : null,
      d.mare ? `MARE: ${d.mare}` : null,
      d.zero_termico ? `ZERO TERMICO: ${d.zero_termico}` : null,
      d.temperature ? `TENDENZA TERMICA: ${d.temperature}` : null,
      d.umidita ? `UMIDITÀ: ${d.umidita}` : null,
      d.segnalazioni ? `SEGNALAZIONI PROT. CIVILE: ${d.segnalazioni}` : null,
      righeRif ? `RIFERIMENTI UFFICIALI: ${righeRif}` : null
    ].filter(Boolean).join('\n'));
  });

  const tend = Object.entries(out.tendenza);
  if (tend.length) {
    parti.push('\n--- TENDENZA (giorni successivi, bassa risoluzione) ---');
    tend.forEach(([iso, t]) => {
      parti.push(`${iso}: ${t.previsioni} | temp: ${t.temperature} | venti: ${t.venti}${t.zero_termico ? ` | zero termico: ${t.zero_termico}` : ''} | attendibilità: ${t.affidabilita}`);
    });
  }

  out.clean = parti.join('\n').trim();

  if (!out.ok || out.clean.length < 200) {
    out.nota = 'Parsing strutturato non riuscito: uso il testo grezzo troncato.';
    out.clean = raw.slice(0, 6000);
  }
} catch (e) {
  out.nota = `Errore parsing (${e.message}): uso il testo grezzo troncato.`;
  out.clean = raw.slice(0, 6000);
}

// ---------------------------------------------------------------------------
// Guardia di contenuto: seconda linea di difesa se la richiesta condizionale
// non dovesse restituire 304. Se il numero di bollettino è lo stesso già
// salvato, non c'è niente di nuovo da scrivere.
// ---------------------------------------------------------------------------
const cambiato = !(precedente && out.bollettino && precedente.bollettino === out.bollettino);
if (!cambiato) out.nota = `Bollettino ${out.bollettino} già presente in tabella: nessuna riscrittura.`;

return { out, cambiato };
}

// ---------------------------------------------------------------------------
const metaItems = $('Filtra e Riabbina').all();

return $input.all().map((item, i) => {
  const meta = metaItems[i]?.json ?? {};
  const { out, cambiato } = analizza(meta, item.json.text);
  return {
    json: {
      regione: out.regione,
      provider: out.provider,
      cambiato,
      bollettino: out.bollettino,
      ok: out.ok,
      nota: out.nota,
      // È questo che finisce nella colonna testo_bollettino
      testo_bollettino: JSON.stringify(out)
    }
  };
});
