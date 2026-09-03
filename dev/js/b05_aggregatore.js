// ============================================================================
// AGGREGATORE DETERMINISTICO (una sola località)
// ============================================================================
// Tutto ciò che è numerico nasce qui. L'LLM non produce mai numeri: li racconta.
//
// Cosa fa:
//  - lavora su una città sola, quella scelta dal bot
//  - calcola qui i fenomeni locali, secondo il profilo della località:
//    nebbia, foehn, inversione termica, neve e zero termico
//  - classifica la convezione con CAPE **e shear**, non col CAPE da solo:
//    2330 J/kg con 0 mm di pioggia non sono un temporale, sono energia
//    inespressa, e senza lo shear non c'è modo di distinguerlo
// ============================================================================

const cfg = $('0. Config').first().json;
// Il contesto arriva dal nodo precedente, che contiene GIÀ sia la richiesta
// risolta sia il bollettino ufficiale letto dalla Data table: ripartire da
// "Risolvi Località" perderebbe i campi ufficiale_*.
const contesto = $('Prepara Bollettino Ufficiale').first().json;
const citta = contesto.citta;
const fenomeni = contesto.fenomeni || [];

// Con UNA coordinata Open-Meteo risponde con un oggetto, non con un array.
const primo = $input.first().json ?? {};
const loc = Array.isArray(primo) ? primo[0] : primo;

if (!loc || !loc.hourly) {
  throw new Error('Risposta Open-Meteo non valida o vuota: impossibile aggregare i dati.');
}

// --- catene di priorità modelli --------------------------------------------
// AROME HD ha ~48 h di corsa: oltre quell'orizzonte i valori sono null e si
// scala da sé sul modello successivo, ora per ora. AROME inoltre non fornisce
// cloud_cover totale, probabilità, CIN e livelli isobarici: per quelle
// grandezze la catena parte direttamente da ICON-D2 / ECMWF.
const M_SUOLO   = ['meteofrance_arome_france_hd', 'icon_d2', 'italia_meteo_arpae_icon_2i', 'ecmwf_ifs025', 'gfs_seamless'];
const M_NUBI    = ['icon_d2', 'italia_meteo_arpae_icon_2i', 'ecmwf_ifs025', 'gfs_seamless'];
const M_PROB    = ['ecmwf_ifs025', 'gfs_seamless'];
const M_CONV    = ['icon_d2', 'italia_meteo_arpae_icon_2i', 'gfs_seamless', 'ecmwf_ifs025'];
const M_QUOTA   = ['ecmwf_ifs025', 'gfs_seamless', 'icon_d2', 'italia_meteo_arpae_icon_2i'];
const M_PIOGGIA = ['meteofrance_arome_france_hd', 'icon_d2', 'italia_meteo_arpae_icon_2i'];
// Neve, zero termico e visibilità: solo ICON-D2 e ICON-2I li danno su tutte le
// località; GFS come rete di sicurezza.
const M_NEVE    = ['icon_d2', 'italia_meteo_arpae_icon_2i', 'gfs_seamless'];

function val(h, base, models, i) {
  for (const m of models) {
    const arr = h[`${base}_${m}`];
    if (Array.isArray(arr)) {
      const v = arr[i];
      if (v !== null && v !== undefined) return v;
    }
  }
  const plain = h[base];
  if (Array.isArray(plain) && plain[i] !== null && plain[i] !== undefined) return plain[i];
  return null;
}

// Per la pioggia il "primo non nullo" sottostima: si prende lo scenario più
// cautelativo tra i modelli ad alta risoluzione.
function maxVal(h, base, models, i) {
  let out = null;
  for (const m of models) {
    const arr = h[`${base}_${m}`];
    const v = Array.isArray(arr) ? arr[i] : null;
    if (v !== null && v !== undefined && (out === null || v > out)) out = v;
  }
  return out;
}

function normalizeWind(dir, speed) {
  if (dir == null || speed == null || speed <= 5) return 'Variabile';
  const d = ((Math.round(dir) % 360) + 360) % 360;
  if (d >= 337 || d <= 22) return 'N';
  if (d <= 67) return 'NE';
  if (d <= 112) return 'E';
  if (d <= 157) return 'SE';
  if (d <= 202) return 'S';
  if (d <= 247) return 'SO';
  if (d <= 292) return 'O';
  return 'NO';
}

// [9,10,11,15,16] -> "09-11, 15-16"
function finestre(ore, maxBlocchi = 2) {
  if (!ore.length) return null;
  const s = [...new Set(ore)].sort((a, b) => a - b);
  const blocchi = [];
  let start = s[0], prev = s[0];
  for (let i = 1; i < s.length; i++) {
    if (s[i] === prev + 1) { prev = s[i]; continue; }
    blocchi.push([start, prev]);
    start = prev = s[i];
  }
  blocchi.push([start, prev]);
  const p = n => String(n).padStart(2, '0');
  return blocchi
    .sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))
    .slice(0, maxBlocchi)
    .sort((a, b) => a[0] - b[0])
    .map(([a, b]) => (a === b ? `${p(a)}:00` : `${p(a)}-${p(b)}`))
    .join(', ');
}

function cieloSintetico(pct) {
  if (pct == null) return 'n/d';
  if (pct < 20) return 'sereno';
  if (pct < 40) return 'poco nuvoloso';
  if (pct < 65) return 'parzialmente nuvoloso';
  if (pct < 85) return 'molto nuvoloso';
  return 'coperto';
}

// Direzione meteorologica (da dove viene) -> componenti u,v in m/s
function componenti(spdKmh, dirDeg) {
  const s = spdKmh / 3.6;
  const r = (dirDeg * Math.PI) / 180;
  return [-s * Math.sin(r), -s * Math.cos(r)];
}

// Deep-layer shear: differenza VETTORIALE fra vento a 500 hPa e vento a 10 m.
// È ciò che distingue un rovescio isolato da una cella organizzata.
function shearMs(spd500, dir500, spd10, dir10) {
  if ([spd500, dir500, spd10, dir10].some(v => v === null || v === undefined)) return null;
  const [u1, v1] = componenti(spd500, dir500);
  const [u2, v2] = componenti(spd10, dir10);
  return Math.hypot(u1 - u2, v1 - v2);
}

// La sola energia non basta a fare un temporale: se nessun modello ad alta
// risoluzione bagna e la probabilità resta bassa, quel CAPE è energia
// INESPRESSA (tappata dall'inibizione o priva di forzante), non un evento.
function classificaConvezione(cape, shear, rainTot, prob, cin) {
  if (cape == null || cape < 300) return 'assente';

  const asciutto = rainTot < 0.2 && prob < 30;
  const tappata = cin !== null && cin > 100 && rainTot < 1;
  if (asciutto || tappata) return 'inespressa';

  if (shear == null) return 'incerta';
  if (cape >= 500 && shear > 20) return 'organizzata';
  if (cape >= 500 && shear >= 10) return 'celle possibili';
  return 'isolata';
}

const media = a => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
const ORE_DETTAGLIO = [0, 3, 6, 9, 12, 15, 18, 21];

const vuoleNebbia     = fenomeni.includes('nebbia');
const vuoleFoehn      = fenomeni.includes('foehn');
const vuoleInversione = fenomeni.includes('inversione');
const vuoleNeve       = fenomeni.includes('neve');

const h = loc.hourly || {};
const times = h.time || [];
const daysMap = {};

for (let i = 0; i < times.length; i++) {
  const dateStr = times[i].substring(0, 10);
  const hour = Number(times[i].substring(11, 13));

  if (!daysMap[dateStr]) {
    daysMap[dateStr] = {
      date: dateStr, orarie: [], dettaglio: [],
      tmin: null, tmax: null, appMin: null, appMax: null,
      windMax: 0, windDirNum: null, gustMax: 0, gustHour: null,
      rainTot: 0, rainMaxH: 0, oreRain: [], probMax: 0,
      capeMax: 0, cinMin: null, shearAlPicco: null, shearMax: 0,
      nubi: [], nubiGiorno: [], nubiAlte: [], umid: [], oreValide: 0,
      // fenomeni
      oreNebbia: [], oreFoschia: [], visMin: null,
      oreFoehn: [], oreInversione: [],
      neveTot: 0, neveMaxDepth: 0, zeroMin: null, zeroMax: null
    };
  }
  const day = daysMap[dateStr];

  // ---- lettura oraria (tutte le 24 ore) ----------------------------------
  const t     = val(h, 'temperature_2m', M_SUOLO, i);
  const tApp  = val(h, 'apparent_temperature', M_SUOLO, i);
  const wspd  = val(h, 'wind_speed_10m', M_SUOLO, i);
  const gust  = val(h, 'wind_gusts_10m', M_SUOLO, i);
  const wdir  = val(h, 'wind_direction_10m', M_SUOLO, i);
  const rain  = maxVal(h, 'precipitation', M_PIOGGIA, i) ?? val(h, 'precipitation', M_SUOLO, i) ?? 0;
  const prob  = val(h, 'precipitation_probability', M_PROB, i) ?? 0;
  const nubi  = val(h, 'cloud_cover', M_NUBI, i);
  const nAlte = val(h, 'cloud_cover_high', M_NUBI, i);
  const rh    = val(h, 'relative_humidity_2m', M_SUOLO, i);
  const cape  = val(h, 'cape', M_CONV, i);
  const cin   = val(h, 'convective_inhibition', M_CONV, i);
  const t850  = val(h, 'temperature_850hPa', M_QUOTA, i);
  const s500  = val(h, 'wind_speed_500hPa', M_QUOTA, i);
  const d500  = val(h, 'wind_direction_500hPa', M_QUOTA, i);

  if (t !== null) {
    day.oreValide++;
    day.tmin = day.tmin === null ? t : Math.min(day.tmin, t);
    day.tmax = day.tmax === null ? t : Math.max(day.tmax, t);
  }
  if (tApp !== null) {
    day.appMin = day.appMin === null ? tApp : Math.min(day.appMin, tApp);
    day.appMax = day.appMax === null ? tApp : Math.max(day.appMax, tApp);
  }
  if (wspd !== null && wspd > day.windMax) { day.windMax = wspd; day.windDirNum = wdir; }
  if (gust !== null && gust > day.gustMax) { day.gustMax = gust; day.gustHour = hour; }
  if (rain > 0) { day.rainTot += rain; day.oreRain.push(hour); }
  if (rain > day.rainMaxH) day.rainMaxH = rain;
  if (prob > day.probMax) day.probMax = prob;
  if (cin !== null && (day.cinMin === null || cin < day.cinMin)) day.cinMin = cin;
  if (nubi !== null) {
    day.nubi.push(nubi);
    if (hour >= 7 && hour <= 20) day.nubiGiorno.push(nubi);
  }
  if (nAlte !== null) day.nubiAlte.push(nAlte);
  if (rh !== null) day.umid.push(rh);
  day.orarie.push({ hour, gust: gust ?? 0 });

  // ---- convezione: lo shear va letto NELL'ORA di massimo CAPE -------------
  const sh = shearMs(s500, d500, wspd, wdir);
  if (sh !== null && sh > day.shearMax) day.shearMax = sh;
  if (cape !== null && cape > day.capeMax) {
    day.capeMax = cape;
    day.shearAlPicco = sh;
  }

  // ---- fenomeni locali ----------------------------------------------------
  if (vuoleNebbia) {
    const vis = val(h, 'visibility', M_NEVE, i);
    const td  = val(h, 'dew_point_2m', M_SUOLO, i);
    if (vis !== null) {
      if (day.visMin === null || vis < day.visMin) day.visMin = vis;
      if (vis < 1000) day.oreNebbia.push(hour);
      else if (vis < 5000) day.oreFoschia.push(hour);
    }
    // Conferma indipendente da irraggiamento notturno: cielo sereno, aria
    // ferma e rugiada vicina alla temperatura. Serve perché i modelli a scala
    // regionale sottostimano regolarmente la nebbia di pianura.
    const notte = hour >= 22 || hour <= 9;
    if (notte && t !== null && td !== null && wspd !== null && nubi !== null &&
        (t - td) < 2.5 && wspd < 6 && nubi < 40 && !day.oreNebbia.includes(hour)) {
      day.oreFoschia.push(hour);
    }
  }

  if (vuoleFoehn) {
    const s850 = val(h, 'wind_speed_850hPa', M_QUOTA, i);
    const d850 = val(h, 'wind_direction_850hPa', M_QUOTA, i);
    if (s850 !== null && d850 !== null && rh !== null) {
      const daNordOvest = d850 >= 270 && d850 <= 360;
      if (daNordOvest && s850 > 25 && rh < 45) day.oreFoehn.push(hour);
    }
  }

  // Proxy di inversione: T850 (~1500 m) più calda del suolo nelle ore notturne.
  // Ha senso solo in pianura e nei fondovalle, dove l'aria fredda ristagna.
  if (vuoleInversione && citta.quota < 800 && hour <= 7) {
    if (t !== null && t850 !== null && t850 > t + 2) day.oreInversione.push(hour);
  }

  if (vuoleNeve) {
    const neve = val(h, 'snowfall', M_NEVE, i);
    const spess = val(h, 'snow_depth', M_NEVE, i);
    const zero = val(h, 'freezing_level_height', M_NEVE, i);
    if (neve !== null && neve > 0) day.neveTot += neve;
    if (spess !== null && spess > day.neveMaxDepth) day.neveMaxDepth = spess;
    if (zero !== null) {
      day.zeroMin = day.zeroMin === null ? zero : Math.min(day.zeroMin, zero);
      day.zeroMax = day.zeroMax === null ? zero : Math.max(day.zeroMax, zero);
    }
  }

  // ---- riga di dettaglio ogni 3 h -----------------------------------------
  if (!ORE_DETTAGLIO.includes(hour)) continue;

  const zRaw = val(h, 'geopotential_height_500hPa', M_QUOTA, i);
  const z500 = zRaw == null ? '-' : Math.round(zRaw / 10);
  const t500 = val(h, 'temperature_500hPa', M_QUOTA, i);

  let riga = ` ${String(hour).padStart(2, '0')}h | Z500:${z500} T500:${t500 != null ? t500.toFixed(1) : '-'} T850:${t850 != null ? t850.toFixed(1) : '-'}` +
    ` | T:${t != null ? t.toFixed(1) : '-'}°C (perc.${tApp != null ? tApp.toFixed(1) : '-'}°C) UR:${rh != null ? Math.round(rh) : '-'}%` +
    ` | Nubi:${nubi != null ? Math.round(nubi) : '-'}% (alte ${nAlte != null ? Math.round(nAlte) : '-'}%)` +
    ` | Pioggia:${rain.toFixed(1)}mm/h Prob:${Math.round(prob)}%` +
    ` | CAPE:${cape != null ? Math.round(cape) : '-'} CIN:${cin != null ? Math.round(cin) : '-'} Shear:${sh != null ? sh.toFixed(0) : '-'}m/s` +
    ` | Vento:${wspd != null ? Math.round(wspd) : '-'}km/h Raff:${gust != null ? Math.round(gust) : '-'}km/h Dir:${wdir != null ? Math.round(wdir) : '-'}°`;

  if (vuoleNeve) {
    const zero = val(h, 'freezing_level_height', M_NEVE, i);
    const neve = val(h, 'snowfall', M_NEVE, i);
    riga += ` | Zero:${zero != null ? Math.round(zero) : '-'}m Neve:${neve != null ? neve.toFixed(1) : '-'}cm`;
  }
  if (vuoleNebbia) {
    const vis = val(h, 'visibility', M_NEVE, i);
    riga += ` | Vis:${vis != null ? Math.round(vis) : '-'}m`;
  }

  day.dettaglio.push(riga);
}

// Scarta le giornate incomplete in coda.
const giorniOrdinati = Object.keys(daysMap).sort()
  .filter(d => daysMap[d].oreValide >= 12)
  .slice(0, cfg.forecast_days || 4);

let testo = '';
const stats = {};

for (const d of giorniOrdinati) {
  const day = daysMap[d];
  const dirStr = normalizeWind(day.windDirNum, day.windMax);
  const nubiMedia = media(day.nubi);
  const nubiDiurne = media(day.nubiGiorno);
  const umidMedia = media(day.umid);

  const sogliaG = day.gustMax * 0.85;
  const oreVento = day.gustMax >= 20 ? day.orarie.filter(r => r.gust >= sogliaG).map(r => r.hour) : [];

  const classe = classificaConvezione(
    day.capeMax, day.shearAlPicco,
    day.rainTot, day.probMax,
    day.cinMin === null ? null : day.cinMin
  );

  const s = {
    tmin: day.tmin !== null ? Number(day.tmin.toFixed(1)) : null,
    tmax: day.tmax !== null ? Number(day.tmax.toFixed(1)) : null,
    perc_min: day.appMin !== null ? Number(day.appMin.toFixed(1)) : null,
    perc_max: day.appMax !== null ? Number(day.appMax.toFixed(1)) : null,
    wind: Math.round(day.windMax),
    gust: Math.round(day.gustMax),
    dir: dirStr,
    rain_tot: Number(day.rainTot.toFixed(1)),
    rain_max_h: Number(day.rainMaxH.toFixed(1)),
    prob: Math.round(day.probMax),
    nuvolosita: nubiMedia,
    nuvolosita_diurna: nubiDiurne,
    nuvolosita_alta: media(day.nubiAlte),
    cielo: cieloSintetico(nubiDiurne ?? nubiMedia),
    umidita: umidMedia,
    cape_max: Math.round(day.capeMax),
    cin_min: day.cinMin !== null ? Math.round(day.cinMin) : null,
    shear_ms: day.shearAlPicco !== null ? Number(day.shearAlPicco.toFixed(1)) : null,
    convezione: classe,
    finestra_pioggia: finestre(day.oreRain),
    finestra_vento: finestre(oreVento)
  };

  // --- fenomeni locali nel riepilogo giornaliero ---------------------------
  if (vuoleNebbia) {
    s.nebbia = day.oreNebbia.length ? finestre(day.oreNebbia) : null;
    s.foschia = day.oreFoschia.length ? finestre(day.oreFoschia) : null;
    s.vis_min = day.visMin !== null ? Math.round(day.visMin) : null;
  }
  if (vuoleFoehn) s.foehn = day.oreFoehn.length ? finestre(day.oreFoehn) : null;
  if (vuoleInversione) s.inversione = day.oreInversione.length ? finestre(day.oreInversione) : null;
  if (vuoleNeve) {
    s.neve_cm = Number(day.neveTot.toFixed(1));
    s.neve_al_suolo_cm = Number((day.neveMaxDepth * 100).toFixed(0)); // snow_depth è in m
    s.zero_termico_min = day.zeroMin !== null ? Math.round(day.zeroMin) : null;
    s.zero_termico_max = day.zeroMax !== null ? Math.round(day.zeroMax) : null;
  }

  stats[d] = s;

  testo += `\n=== GIORNO: ${d} ===\n`;
  testo += `[VALORI AGGREGATI DETERMINISTICI — calcolati su tutte le 24 h]\n`;
  testo += `- Tmin/Tmax: ${s.tmin ?? '-'} / ${s.tmax ?? '-'} °C (percepita ${s.perc_min ?? '-'} / ${s.perc_max ?? '-'} °C)\n`;
  testo += `- Cielo: ${s.cielo} (copertura media diurna ${nubiDiurne ?? '-'} %, nubi alte ${s.nuvolosita_alta ?? '-'} %) | Umidità relativa media: ${umidMedia ?? '-'} %\n`;
  testo += `- Vento max: ${s.wind} km/h da ${dirStr} | raffica max: ${s.gust} km/h${s.finestra_vento ? ` | rinforzi ore ${s.finestra_vento}` : ''}\n`;
  testo += `- Pioggia TOTALE giornaliera: ${s.rain_tot} mm | intensità oraria max: ${s.rain_max_h} mm/h | probabilità max: ${s.prob} %`;
  testo += s.finestra_pioggia ? ` | fenomeni ore ${s.finestra_pioggia}\n` : ` | nessuna ora con precipitazione prevista\n`;
  testo += `- Convezione: ${classe.toUpperCase()} (CAPE max ${s.cape_max} J/kg, CIN min ${s.cin_min ?? '-'} J/kg, shear al picco ${s.shear_ms ?? '-'} m/s)\n`;

  if (vuoleNeve) {
    testo += `- Zero termico: ${s.zero_termico_min ?? '-'}–${s.zero_termico_max ?? '-'} m | Neve prevista: ${s.neve_cm} cm | Manto al suolo: ${s.neve_al_suolo_cm} cm\n`;
  }
  if (vuoleNebbia) {
    testo += `- Visibilità minima: ${s.vis_min ?? '-'} m`;
    testo += s.nebbia ? ` | NEBBIA ore ${s.nebbia}` : '';
    testo += s.foschia ? ` | foschia ore ${s.foschia}` : '';
    testo += (!s.nebbia && !s.foschia) ? ' | nessuna riduzione di visibilità' : '';
    testo += '\n';
  }
  if (vuoleFoehn) {
    testo += `- Foehn: ${s.foehn ? `condizioni favorevoli ore ${s.foehn}` : 'nessun segnale'}\n`;
  }
  if (vuoleInversione) {
    testo += `- Inversione termica notturna (proxy T850 vs suolo): ${s.inversione ? `probabile ore ${s.inversione}` : 'non indicata'}\n`;
  }

  testo += `\n[DETTAGLIO ORARIO OGNI 3 H]\n`;
  testo += day.dettaglio.join('\n') + '\n';
}

return [{
  json: {
    ...contesto,
    dati_modelli: testo,
    raw_stats: stats,
    giorni_previsti: giorniOrdinati,
    quota_modello: loc.elevation ?? null
  }
}];
