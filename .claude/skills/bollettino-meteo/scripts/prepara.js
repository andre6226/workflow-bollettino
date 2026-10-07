#!/usr/bin/env node
// ============================================================================
// PREPARA — tutto ciò che nel workflow B viene prima dell'Agente Capo.
// ============================================================================
//   node prepara.js "<località>" [cartella_lavoro]
//
// 1. risolve la località sulle città di "0. Config"
// 2. scarica il PDF ufficiale della regione (ARPAL / ARPA Piemonte), lo
//    converte con pdftotext e lo passa al parser del workflow A
// 3. scarica Open-Meteo e lo passa all'aggregatore deterministico
// 4. scrive contesto.json (serve a finalizza.js) e dati.md (da leggere)
//
// Uscita 2 = località sconosciuta, con l'elenco di quelle disponibili.
// ============================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { esegui } = require('./nodi');

const MODELLI = 'icon_d2,meteofrance_arome_france_hd,italia_meteo_arpae_icon_2i,ecmwf_ifs025,gfs_seamless';

async function scarica(url, opzioni = {}) {
  for (let tentativo = 1; ; tentativo++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(45000), ...opzioni });
      if (!r.ok) throw new Error(`HTTP ${r.status} da ${url}`);
      return r;
    } catch (e) {
      if (tentativo >= 3) throw e;
      await new Promise(res => setTimeout(res, 3000));
    }
  }
}

// Bollettino ufficiale -> riga come quella della Data table "bollettini".
// Se qualcosa va storto si prosegue coi soli modelli, come fa il workflow.
async function rigaUfficiale(regione, dir) {
  const fonti = await esegui('a01_fonti.js', {}, []);
  const fonte = fonti.find(f => f.regione === regione);
  if (!fonte) return { riga: {}, errore: `nessuna fonte ufficiale per "${regione}"` };
  try {
    const pdf = path.join(dir, `${fonte.provider}.pdf`);
    const r = await scarica(fonte.url);
    fs.writeFileSync(pdf, Buffer.from(await r.arrayBuffer()));
    const testo = execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' });
    fs.writeFileSync(path.join(dir, `${fonte.provider}.txt`), testo);

    const meta = { ...fonte, last_modified: r.headers.get('last-modified'), precedente: null };
    const [esito] = await esegui('a03_parser_bollettino.js',
      { 'Filtra e Riabbina': meta }, { text: testo });
    return {
      riga: { regione, testo_bollettino: esito.testo_bollettino, updatedAt: new Date().toISOString() },
      errore: esito.ok ? null : `parser: ${esito.nota || 'bollettino non riconosciuto'}`
    };
  } catch (e) {
    return { riga: {}, errore: `${fonte.nome_fonte}: ${e.message}` };
  }
}

async function main() {
  const richiesta = process.argv[2];
  if (!richiesta) {
    console.error('uso: node prepara.js "<località>" [cartella_lavoro]');
    process.exit(1);
  }

  const [cfg] = await esegui('b00_config.js');
  const [risolta] = await esegui('b03_risolvi_localita.js',
    { '0. Config': cfg }, { localita_richiesta: richiesta });

  if (risolta.errore) {
    console.log(`LOCALITÀ SCONOSCIUTA: "${richiesta}"`);
    console.log(`Disponibili: ${risolta.elenco_localita}`);
    process.exit(2);
  }

  const citta = risolta.citta;
  const oggi = new Date().toISOString().slice(0, 10);
  const dir = process.argv[3] || path.join(os.tmpdir(), 'bollettino-meteo', `${citta.id}-${oggi}`);
  fs.mkdirSync(dir, { recursive: true });

  const [{ riga, errore }, om] = await Promise.all([
    rigaUfficiale(citta.regione, dir),
    scarica('https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
      latitude: citta.lat, longitude: citta.lon, models: MODELLI,
      hourly: risolta.hourly, forecast_days: cfg.forecast_days, timezone: 'auto'
    })).then(r => r.json())
  ]);
  fs.writeFileSync(path.join(dir, 'open_meteo.json'), JSON.stringify(om));

  const [preparato] = await esegui('b04_prepara_bollettino.js',
    { '0. Config': cfg, 'Risolvi Località': risolta }, riga);
  if (errore) {
    preparato.ufficiale_nota = [preparato.ufficiale_nota, `Fonte ufficiale non letta (${errore}).`]
      .filter(Boolean).join(' ');
  }

  const [contesto] = await esegui('b05_aggregatore.js',
    { '0. Config': cfg, 'Prepara Bollettino Ufficiale': preparato }, om);

  // I micro-agenti non servono: Claude legge direttamente i dati dei modelli.
  contesto.micro_agenti_falliti = [];
  fs.writeFileSync(path.join(dir, 'contesto.json'), JSON.stringify(contesto, null, 2));

  const md = [
    `# Dati per il bollettino — ${citta.nome}`,
    '',
    `- quota: ${citta.quota} m s.l.m. (quota del modello: ${contesto.quota_modello ?? 'n/d'} m)`,
    `- profilo: ${citta.profilo} — fenomeni locali: ${(contesto.fenomeni || []).join(', ') || 'nessuno'}`,
    `- quarta casella: ${contesto.riquadro}`,
    `- giorni da descrivere (data_iso, in quest'ordine): ${contesto.giorni_previsti.join(', ')}`,
    contesto.ufficiale_nota ? `- NOTA: ${contesto.ufficiale_nota}` : null,
    '',
    `## Fonte ufficiale (${contesto.ufficiale_nome || 'non disponibile'})`,
    '',
    '```',
    contesto.ufficiale_clean,
    '```',
    '',
    '## Modelli numerici (aggregatore deterministico)',
    '',
    '```',
    contesto.dati_modelli.trim(),
    '```'
  ].filter(x => x !== null).join('\n');
  fs.writeFileSync(path.join(dir, 'dati.md'), md + '\n');

  console.log(`OK ${citta.nome} — cartella di lavoro: ${dir}`);
  console.log(`giorni: ${contesto.giorni_previsti.join(', ')}`);
  console.log(`fonte ufficiale: ${contesto.ufficiale_nome || 'assente'}${contesto.ufficiale_numero ? ` n.${contesto.ufficiale_numero}` : ''}`);
  if (contesto.ufficiale_nota) console.log(`nota: ${contesto.ufficiale_nota}`);
  console.log(`leggi: ${path.join(dir, 'dati.md')}`);
}

main().catch(e => { console.error('ERRORE:', e.message); process.exit(1); });
