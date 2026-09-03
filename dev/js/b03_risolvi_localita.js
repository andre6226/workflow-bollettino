// ============================================================================
// RISOLVI LOCALITÀ
// ============================================================================
// Abbina il testo scritto dall'utente a una delle località configurate.
// Confronto insensibile a maiuscole, accenti e punteggiatura, prima esatto e
// poi per prefisso ("limone" trova "Limone Piemonte").
//
// Se non si risolve, l'item prosegue con `errore` e il nodo IF a valle lo manda
// alla risposta Telegram invece che nella pipeline.
// ============================================================================

const cfg = $('0. Config').first().json;
const citta = cfg.citta || [];
const profili = cfg.profili || {};

// "Limone Piemonte" -> "limone piemonte";  "Città" -> "citta"
function normalizza(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const indice = citta.map(c => ({
  citta: c,
  chiavi: [...new Set([c.id, c.nome, ...(c.alias || [])].map(normalizza))]
}));

const elenco = citta.map(c => c.nome).join(', ');

// ---------------------------------------------------------------------------
// Variabili da chiedere a Open-Meteo: si scarica SOLO quello che il profilo
// userà davvero. Costruirle qui tiene il nodo HTTP con una espressione banale.
// ---------------------------------------------------------------------------
const BASE = [
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
  'cloud_cover', 'cloud_cover_high',
  'precipitation', 'precipitation_probability',
  'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m',
  'cape', 'convective_inhibition',
  'temperature_850hPa', 'geopotential_height_500hPa', 'temperature_500hPa',
  // servono per lo shear, che si valuta ovunque
  'wind_speed_500hPa', 'wind_direction_500hPa'
];

function variabiliPer(fen) {
  const extra = [];
  if (fen.includes('nebbia') || fen.includes('inversione')) extra.push('dew_point_2m', 'visibility');
  if (fen.includes('foehn')) extra.push('wind_speed_850hPa', 'wind_direction_850hPa');
  if (fen.includes('neve')) extra.push('snowfall', 'snow_depth', 'freezing_level_height');
  return [...new Set([...BASE, ...extra])].join(',');
}

return $input.all().map(item => {
  const j = item.json;

  // Errori già rilevati a monte (email mancante, ecc.): si passa oltre.
  if (j.errore) return { json: { ...j, elenco_localita: elenco } };

  const cercata = normalizza(j.localita_richiesta);

  let trovata = indice.find(e => e.chiavi.includes(cercata));
  if (!trovata) trovata = indice.find(e => e.chiavi.some(k => k.startsWith(cercata) && cercata.length >= 3));
  if (!trovata) trovata = indice.find(e => e.chiavi.some(k => cercata.startsWith(k)));

  if (!trovata) {
    return { json: { ...j, errore: 'localita_sconosciuta', elenco_localita: elenco } };
  }

  const c = trovata.citta;
  const profilo = profili[c.profilo] || { fenomeni: [], riquadro: 'mare' };

  return {
    json: {
      ...j,
      errore: null,
      elenco_localita: elenco,
      citta: c,
      citta_id: c.id,
      regione: c.regione,
      // La convezione si valuta ovunque; il resto dipende dal profilo.
      fenomeni: profilo.fenomeni,
      riquadro: profilo.riquadro,
      hourly: variabiliPer(profilo.fenomeni)
    }
  };
});
