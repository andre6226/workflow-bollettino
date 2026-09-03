const fs=require('fs'); const SP=process.env.SP;
const J=f=>fs.readFileSync(SP+'/js/'+f,'utf8');
const run=(body,$,input)=>new Function('$','$input','return (function(){'+body+'})();')($,input);

const cfg=run(J('b00_config.js'),null,null)[0].json;
const risolte=JSON.parse(fs.readFileSync(SP+'/fixture/risolte.json','utf8'));

// --- costruisco le righe della Data table col parser vero -------------------
const parser=J('a03_parser_bollettino.js');
const meta=[{json:{regione:'liguria',provider:'arpal',last_modified:'x'}},
            {json:{regione:'piemonte',provider:'arpa_piemonte',last_modified:'y'}}];
const testi=[{json:{text:fs.readFileSync(SP+'/fixture/arpal_raw.txt','utf8')}},
             {json:{text:fs.readFileSync(SP+'/fixture/pie.txt','utf8')}}];
const righe={};
run(parser,()=>({all:()=>meta}),{all:()=>testi}).forEach(r=>{
  righe[r.json.regione]={regione:r.json.regione, testo_bollettino:r.json.testo_bollettino,
                         updatedAt:new Date().toISOString()};
});

// --- risposta finta dell'Agente Capo (con difetti apposta) ------------------
function fintoCapo(giorni, citta){
  const d=(i)=>`Giornata di cielo variabile su ${citta}, con addensamenti nelle ore centrali e schiarite verso sera. `+
    `La ventilazione resta debole con qualche rinforzo pomeridiano. L'energia presente in quota rimane inespressa `+
    `e non porta a fenomeni. Le temperature si mantengono sopra la media e l'umidità rende la percezione più pesante. `+
    `Nessun fenomeno registrato nell'arco della giornata.`;
  const g=giorni.slice(0,3).map((iso,i)=>({data_iso:iso, descrizione:d(i)})); // 4o giorno MANCANTE apposta
  return '```json\n'+JSON.stringify({
    quadro_generale:`Anticiclone in <rinforzo> & aria fresca in quota su ${citta}.`,
    confronto_ufficiale:'Modelli e fonte ufficiale concordano sull\'assenza di fenomeni.',
    confidenza:'Alta', giorni:g})+'\n```';
}

let problemi=0;
for (const r of risolte) {
  const citta=r.citta;
  const om=JSON.parse(fs.readFileSync(SP+`/fixture/om_${citta.id}.json`,'utf8'));
  const richiesta={...r, emails:['dest@esempio.it'], chat_id:12345};

  // 1. Leggi Bollettino Ufficiale (Data table) + Prepara
  const riga=righe[citta.regione]||{};
  const $prep=(n)=>({first:()=>({json: n==='0. Config'?cfg:richiesta})});
  const contesto1=run(J('b04_prepara_bollettino.js'),$prep,{first:()=>({json:riga})})[0].json;

  // 2. Aggregatore
  const $agg=(n)=>({first:()=>({json: n==='0. Config'?cfg:contesto1})});
  const contesto2=run(J('b05_aggregatore.js'),$agg,{first:()=>({json:om})})[0].json;

  // 3. Micro-agenti (simulati)
  const contesto3={...contesto2, rep_quota:'* **09-02:** Sinottica ok. Giudizio: energia inespressa.',
                   rep_suolo:'* **09-02:** Tmin_Tmax ok. Finestra Fenomeni: Fenomeni assenti.',
                   micro_agenti_falliti:[]};

  // 4. Agente Capo (simulato) -> 5. Validatore
  const $val=(n)=>({first:()=>({json: n==='0. Config'?cfg:contesto3})});
  const validato=run(J('b07_validatore.js'),$val,
    {first:()=>({json:{text:fintoCapo(contesto2.giorni_previsti,citta.nome)}})})[0].json;

  // 6. HTML
  const out=run(J('b08_formatta_html.js'),null,{first:()=>({json:validato})})[0].json;
  const dirAnteprime = SP + '/anteprime';
  fs.mkdirSync(dirAnteprime, { recursive: true });
  fs.writeFileSync(`${dirAnteprime}/anteprima_${citta.id}.html`, out.html);

  // --- controlli ---
  const g0=validato.forecast.giorni[0];
  const gUltimo=validato.forecast.giorni[3];
  const chiavi=Object.keys(g0);
  const attesa={mare:'mare', neve:'zero_termico_min', visibilita:'vis_min'}[r.riquadro];
  const vietate={mare:['zero_termico_min','vis_min'], neve:['mare','vis_min'], visibilita:['mare','zero_termico_min']}[r.riquadro];

  const okRiquadro = chiavi.includes(attesa) && !vietate.some(k=>chiavi.includes(k));
  const okGiorni = validato.forecast.giorni.length===4;
  const okRiallineo = gUltimo.tmin!==null && gUltimo.descrizione.includes('non disponibile');
  const okEscape = out.html.includes('&lt;rinforzo&gt;');
  const okRegistrato = !/registrat/i.test(out.html);

  [okRiquadro,okGiorni,okRiallineo,okEscape,okRegistrato].forEach(v=>{ if(!v) problemi++; });

  console.log('='.repeat(78));
  console.log(`${citta.nome}  [${citta.profilo} -> riquadro ${r.riquadro}]`);
  console.log(`  4 giorni presenti nonostante il 4o mancante dall'LLM : ${okGiorni?'SI':'NO'}`);
  console.log(`  4o giorno riallineato con numeri veri + placeholder   : ${okRiallineo?'SI':'NO'}`);
  console.log(`  quarta casella corretta (${attesa}) e nessuna estranea : ${okRiquadro?'SI':'NO'}`);
  console.log(`  escape HTML / "registrato" ripulito                   : ${okEscape?'SI':'NO'} / ${okRegistrato?'SI':'NO'}`);
  console.log(`  fonte: ${validato.meta.fonte} n.${validato.meta.bollettino} | avvisi: ${validato.meta.avvisi.length?validato.meta.avvisi.join(' · '):'nessuno'}`);
  console.log(`  HTML ${out.html.length} char -> anteprime/anteprima_${citta.id}.html`);
}
console.log('\n'+(problemi?`${problemi} CONTROLLI FALLITI`:'tutti i controlli superati'));
