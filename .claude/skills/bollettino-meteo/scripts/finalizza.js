#!/usr/bin/env node
// ============================================================================
// FINALIZZA — validatore + formattazione, come in coda al workflow B.
// ============================================================================
//   node finalizza.js <cartella_lavoro> [testo.json]
//
// Legge contesto.json (da prepara.js) e il JSON scritto da Claude
// (default <cartella>/testo.json). I numeri li rimette lo script: dal testo
// arrivano solo le descrizioni. Scrive bollettino.html e bollettino.txt.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { esegui } = require('./nodi');

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('uso: node finalizza.js <cartella_lavoro> [testo.json]');
    process.exit(1);
  }
  const contesto = JSON.parse(fs.readFileSync(path.join(dir, 'contesto.json'), 'utf8'));
  const testo = fs.readFileSync(process.argv[3] || path.join(dir, 'testo.json'), 'utf8');

  const [cfg] = await esegui('b00_config.js');
  const [validato] = await esegui('b07_validatore.js',
    { '0. Config': cfg, 'Micro-Agenti': contesto }, { text: testo });
  const [out] = await esegui('b08_formatta_html.js', {}, validato);

  fs.writeFileSync(path.join(dir, 'bollettino.html'), out.html);
  fs.writeFileSync(path.join(dir, 'bollettino.txt'), out.text + '\n');

  console.log(`HTML: ${path.join(dir, 'bollettino.html')}`);
  console.log(`TXT:  ${path.join(dir, 'bollettino.txt')}`);
  const avvisi = validato.meta.avvisi || [];
  console.log(`avvisi: ${avvisi.length ? avvisi.join(' · ') : 'nessuno'}`);
}

main().catch(e => { console.error('ERRORE:', e.message); process.exit(1); });
