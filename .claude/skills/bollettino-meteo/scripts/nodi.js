// ============================================================================
// Esegue i nodi Code dei workflow n8n fuori da n8n.
// ============================================================================
// I sorgenti restano quelli di dev/js: la skill non ne tiene una copia, così
// workflow e skill calcolano gli stessi numeri con lo stesso codice.
// $ e $input sono finti, costruiti come nei test di dev/.
// ============================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = 'andre6226/workflow-bollettino';
const RAMO = 'main';
const UN_GIORNO = 24 * 3600 * 1000;

// Dove stanno i nodi, in ordine:
//  1. METEO_DEV_JS esplicito
//  2. la skill vive dentro il repo (.claude/skills/...): si usa quello
//  3. copia in cache scaricata da GitHub, aggiornata al massimo una volta al giorno
function trovaDirJs() {
  if (process.env.METEO_DEV_JS) return process.env.METEO_DEV_JS;

  const nelRepo = path.resolve(__dirname, '../../../../dev/js');
  if (fs.existsSync(path.join(nelRepo, 'b00_config.js'))) return nelRepo;

  const cache = process.env.METEO_CACHE ||
    path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'bollettino-meteo');
  const repo = path.join(cache, 'workflow-bollettino');
  const dirJs = path.join(repo, 'dev', 'js');
  const segno = path.join(cache, '.ultimo_aggiornamento');

  const presente = fs.existsSync(path.join(dirJs, 'b00_config.js'));
  const recente = presente && fs.existsSync(segno) &&
    Date.now() - fs.statSync(segno).mtimeMs < UN_GIORNO;
  if (recente) return dirJs;

  try {
    fs.mkdirSync(cache, { recursive: true });
    scaricaRepo(repo, presente);
    fs.writeFileSync(segno, new Date().toISOString() + '\n');
  } catch (e) {
    // Offline o GitHub irraggiungibile: va bene la copia vecchia, se c'è.
    if (!presente) throw new Error(`Impossibile scaricare ${REPO} da GitHub: ${e.message}`);
    console.error(`avviso: aggiornamento di ${REPO} fallito, uso la copia in cache (${e.message.split('\n')[0]})`);
  }
  return dirJs;
}

function scaricaRepo(repo, presente) {
  const opz = { stdio: ['ignore', 'ignore', 'pipe'], timeout: 120000 };
  let git = true;
  try { execFileSync('git', ['--version'], opz); } catch (e) { git = false; }

  if (git && fs.existsSync(path.join(repo, '.git'))) {
    execFileSync('git', ['-C', repo, 'fetch', '--depth', '1', 'origin', RAMO], opz);
    execFileSync('git', ['-C', repo, 'reset', '--hard', 'FETCH_HEAD'], opz);
    return;
  }
  // Senza git (o con una copia da tarball) si riparte da zero.
  const tmp = `${repo}.nuovo`;
  fs.rmSync(tmp, { recursive: true, force: true });
  if (git) {
    execFileSync('git', ['clone', '--depth', '1', '--branch', RAMO, `https://github.com/${REPO}.git`, tmp], opz);
  } else {
    fs.mkdirSync(tmp, { recursive: true });
    const tgz = `${tmp}.tar.gz`;
    execFileSync('curl', ['-fsSL', '-o', tgz, `https://codeload.github.com/${REPO}/tar.gz/refs/heads/${RAMO}`], opz);
    execFileSync('tar', ['-xzf', tgz, '-C', tmp, '--strip-components=1'], opz);
    fs.rmSync(tgz, { force: true });
  }
  if (presente) fs.rmSync(repo, { recursive: true, force: true });
  fs.renameSync(tmp, repo);
}

const DIR_JS = trovaDirJs();

function sorgente(file) {
  const p = path.join(DIR_JS, file);
  if (!fs.existsSync(p)) {
    throw new Error(`Nodo non trovato: ${p}. Imposta METEO_DEV_JS sulla cartella dev/js del repo ${REPO}.`);
  }
  return fs.readFileSync(p, 'utf8');
}

// nodi: { 'Nome Nodo': json | [json, ...] }   input: json | [json, ...]
function esegui(file, nodi = {}, input = []) {
  const items = v => (Array.isArray(v) ? v : [v]).map(json => ({ json }));
  const $ = nome => {
    if (!(nome in nodi)) throw new Error(`${file} chiede il nodo "${nome}", non fornito`);
    const it = items(nodi[nome]);
    return { first: () => it[0], all: () => it };
  };
  const inp = items(input);
  const $input = { first: () => inp[0], all: () => inp };
  const corpo = sorgente(file);
  // Le Code node possono usare await (es. Micro-Agenti): avvolgo in async.
  return new Function('$', '$input', '$env', `return (async function(){${corpo}})();`)($, $input, undefined)
    .then(out => out.map(o => o.json));
}

module.exports = { esegui, DIR_JS };
