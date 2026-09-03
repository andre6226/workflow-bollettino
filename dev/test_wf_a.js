const fs=require('fs'); const SP=process.env.SP;
const J=f=>fs.readFileSync(SP+'/js/'+f,'utf8');
const run=(body,$,input)=>new Function('$','$input','return (function(){'+body+'})();')($,input);

const TESTI={arpal:fs.readFileSync(SP+'/fixture/arpal_raw.txt','utf8'),
             arpa_piemonte:fs.readFileSync(SP+'/fixture/pie.txt','utf8')};
const LM={arpal:'Tue, 01 Sep 2026 10:34:03 GMT', arpa_piemonte:'Tue, 01 Sep 2026 21:35:05 GMT'};

// tabella simulata, persistente tra le esecuzioni
let tabella=[];

function esecuzione(etichetta, rispostaServer){
  console.log('\n'+'#'.repeat(74)); console.log('# '+etichetta); console.log('#'.repeat(74));

  // 1. Leggi Stato Corrente -> righe (o un item vuoto se tabella vuota)
  const righe = tabella.length ? tabella.map(r=>({json:r})) : [{json:{}}];

  // 2. Fonti da Controllare
  const fonti = run(J('a01_fonti.js'), null, {all:()=>righe});
  fonti.forEach(f=>console.log(`  fonte ${f.json.regione.padEnd(9)} If-Modified-Since: ${f.json.last_modified}`));

  // 3. Scarica se Cambiato (simulato) -> fullResponse: json sostituito
  const scaricati = fonti.map(f=>{
    const s = rispostaServer(f.json.regione);
    if (s===304) return {json:{statusCode:304, headers:{}}};
    return {json:{statusCode:200, headers:{'last-modified':LM[f.json.provider]}},
            binary:{data:{fileName:'b.pdf'}}};
  });
  console.log('  risposte:', scaricati.map(s=>s.json.statusCode).join(', '));

  // 4. Filtra e Riabbina
  const $filtra=(n)=>({all:()=>fonti});
  const passati = run(J('a02_filtra.js'), $filtra, {all:()=>scaricati});
  console.log('  sopravvissuti al filtro:', passati.length);
  if(!passati.length){ console.log('  -> nessuna scrittura, esecuzione conclusa'); return; }

  // 5. Estrai Testo PDF (simulato, 1:1)
  const estratti = passati.map(p=>({json:{text:TESTI[p.json.provider]}}));

  // 6. Parser
  const $parser=(n)=>({all:()=>passati});
  const parsati = run(J('a03_parser_bollettino.js'), $parser, {all:()=>estratti});

  // 7. Solo se Cambiato
  const daSalvare = parsati.filter(p=>p.json.cambiato);
  parsati.forEach(p=>console.log(`  ${p.json.regione.padEnd(9)} boll=${p.json.bollettino} cambiato=${p.json.cambiato}${p.json.nota?' ('+p.json.nota+')':''}`));

  // 8. Salva Bollettino (upsert su regione)
  daSalvare.forEach(p=>{
    const i=tabella.findIndex(r=>r.regione===p.json.regione);
    const riga={regione:p.json.regione, testo_bollettino:p.json.testo_bollettino};
    if(i>=0) tabella[i]=riga; else tabella.push(riga);
  });
  console.log('  righe in tabella:', tabella.length, '->', tabella.map(r=>r.regione).join(', '));
}

esecuzione('1a esecuzione: tabella vuota, entrambe le fonti nuove', ()=>200);
esecuzione('2a esecuzione: nulla cambiato lato server (304)',       ()=>304);
esecuzione('3a esecuzione: server ripubblica lo stesso bollettino', ()=>200);
console.log('\nverifica finale: la tabella deve avere 2 righe con JSON valido');
tabella.forEach(r=>{const o=JSON.parse(r.testo_bollettino);
  console.log(`  ${r.regione.padEnd(9)} boll=${o.bollettino} giorni=${Object.keys(o.by_date).length} clean=${o.clean.length}ch`);});
