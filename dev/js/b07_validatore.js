// ============================================================================
// VALIDATORE E SOVRASCRITTURA NUMERICA
// ============================================================================
// La lista dei giorni la decide lo SCRIPT, non l'LLM: se il modello salta una
// giornata o sbaglia una data, la mail resta corretta. I numeri vengono tutti
// riscritti da qui, l'LLM contribuisce solo il testo.
// ============================================================================

const cfg = $('0. Config').first().json;
const rawText = String($input.first().json.text || '');

// L'Agente Capo (chainLlm) restituisce SOLO { text }: il contesto va ripreso
// dal nodo che l'ha prodotto.
const contesto = $('Micro-Agenti').first().json;
const citta = contesto.citta;
const riquadro = contesto.riquadro;

// --- 1. estrazione del JSON -------------------------------------------------
function estraiJson(testo) {
  let t = testo.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const primo = t.indexOf('{');
  const ultimo = t.lastIndexOf('}');
  if (primo === -1 || ultimo === -1 || ultimo <= primo) return null;
  t = t.substring(primo, ultimo + 1);
  try { return JSON.parse(t); } catch (e) { /* si tenta la ripulitura */ }
  try { return JSON.parse(t.replace(/,\s*([}\]])/g, '$1')); } catch (e) { return null; }
}

const data = estraiJson(rawText);
if (!data) {
  throw new Error(
    'JSON non valido dall\'Agente Capo. Primi 400 caratteri della risposta:\n' + rawText.slice(0, 400)
  );
}

// --- 2. utilità -------------------------------------------------------------
const GIORNI_IT = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];

function titoloIta(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  if (isNaN(d)) return iso;
  return `${GIORNI_IT[d.getUTCDay()]} (${iso.slice(8, 10)}-${iso.slice(5, 7)})`;
}

// Tiene solo le parti della riga MARE pertinenti alla zona della località.
// "Mosso a Levante, poco mosso ovunque la sera" + ponente -> "Poco mosso ovunque la sera"
function mareZona(testo, zona) {
  if (!testo) return '';
  const zone = ['ponente', 'centro', 'levante'];
  const altre = zone.filter(z => z !== zona);
  const proprie = [], generiche = [];

  for (const c of testo.split(',').map(s => s.trim()).filter(Boolean)) {
    const low = c.toLowerCase();
    if (altre.some(z => low.includes(z))) continue;
    if (low.includes(zona)) proprie.push(c); else generiche.push(c);
  }
  const scelte = proprie.length ? proprie.concat(generiche) : generiche;
  if (!scelte.length) return '';
  const s = scelte.join(', ').replace(/\s+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function ripulisciTesto(s) {
  return String(s || '')
    .replace(/si registrer[àa]/gi, 'si prevede')
    .replace(/registrat([oaie])/gi, (_, v) => ({ o: 'previsto', a: 'prevista', i: 'previsti', e: 'previste' }[v.toLowerCase()]))
    .replace(/\s+/g, ' ')
    .trim();
}

// --- 3. dati deterministici -------------------------------------------------
const raw_stats = contesto.raw_stats || {};
const dateKeys = (contesto.giorni_previsti || []).length
  ? contesto.giorni_previsti
  : Object.keys(raw_stats).sort();

const byDate = contesto.ufficiale_by_date || {};
const tendenza = contesto.ufficiale_tendenza || {};
const giorniLlm = Array.isArray(data.giorni) ? data.giorni : [];

const giorni = dateKeys.map((iso, index) => {
  // abbinamento: data_iso -> posizione
  let g = giorniLlm.find(x => String(x.data_iso || '').trim() === iso) || giorniLlm[index] || {};

  const s = raw_stats[iso] || {};
  const uff = byDate[iso] || {};
  const tend = tendenza[iso] || {};

  // --- la quarta metrica dipende dal profilo della località ----------------
  const extra = {};
  if (riquadro === 'mare') {
    let mare = mareZona(uff.mare, citta.zona_mare);
    if (!mare) mare = 'Non disponibile';
    extra.mare = mare;
  } else if (riquadro === 'neve') {
    extra.zero_termico_min = s.zero_termico_min ?? null;
    extra.zero_termico_max = s.zero_termico_max ?? null;
    extra.neve_cm = s.neve_cm ?? 0;
    extra.neve_al_suolo_cm = s.neve_al_suolo_cm ?? 0;
  } else if (riquadro === 'visibilita') {
    extra.vis_min = s.vis_min ?? null;
    extra.nebbia = s.nebbia || null;
    extra.foschia = s.foschia || null;
  }

  return {
    data_iso: iso,
    titolo: titoloIta(iso),
    descrizione: ripulisciTesto(g.descrizione) || '(descrizione non disponibile per questa giornata)',

    // --- numeri: sempre e solo dallo script -------------------------------
    tmin: s.tmin ?? null,
    tmax: s.tmax ?? null,
    perc_min: s.perc_min ?? null,
    perc_max: s.perc_max ?? null,
    vento_dir: s.dir || 'Variabile',
    vento_kmh: s.wind ?? null,
    raffiche_kmh: s.gust ?? null,
    pioggia_mm: s.rain_tot ?? 0,
    pioggia_max_h: s.rain_max_h ?? 0,
    prob_pioggia: s.prob ?? 0,
    nuvolosita: s.nuvolosita_diurna ?? s.nuvolosita ?? null,
    cielo: s.cielo || 'n/d',
    umidita: s.umidita ?? null,
    convezione: s.convezione || 'assente',
    finestra_pioggia: s.finestra_pioggia || null,
    finestra_vento: s.finestra_vento || null,
    foehn: s.foehn || null,
    inversione: s.inversione || null,
    ...extra,

    uff_cielo: uff.cielo || tend.previsioni || '',
    uff_affidabilita: uff.affidabilita || tend.affidabilita || ''
  };
});

// --- 4. avvisi diagnostici (finiscono nel piè di pagina della mail) ---------
const avvisi = [];
if (contesto.ufficiale_nota) avvisi.push(contesto.ufficiale_nota);
const falliti = contesto.micro_agenti_falliti || [];
if (falliti.length) avvisi.push(`Micro-agenti non disponibili: ${falliti.length} su 2.`);

const troppoCorte = giorni.filter(g => g.descrizione.split(/\s+/).length < 35).length;
if (troppoCorte) avvisi.push(`${troppoCorte} descrizioni più brevi del previsto.`);

return [{
  json: {
    forecast: {
      citta: citta.nome,
      profilo: citta.profilo,
      riquadro,
      quadro_generale: ripulisciTesto(data.quadro_generale),
      confronto_ufficiale: ripulisciTesto(data.confronto_ufficiale || data.confronto_arpal),
      confidenza: ['Alta', 'Media', 'Bassa'].includes(data.confidenza) ? data.confidenza : 'Media',
      giorni
    },
    meta: {
      fonte: contesto.ufficiale_nome || null,
      bollettino: contesto.ufficiale_numero || null,
      emissione: contesto.ufficiale_emissione || null,
      quota: citta.quota,
      quota_modello: contesto.quota_modello ?? null,
      giorni: dateKeys,
      avvisi
    },
    emails: contesto.emails,
    chat_id: contesto.chat_id
  }
}];
