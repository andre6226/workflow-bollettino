const fs=require('fs'); const SP=process.env.SP;
const J=f=>fs.readFileSync(SP+'/js/'+f,'utf8');
const run=(body,$,input,extra={})=>new Function('$','$input','$json','$getWorkflowStaticData',
  'return (function(){'+body+'})();')($,input,extra.$json,extra.sd);

const cfg=run(J('b00_config.js'),null,null)[0].json;
const $c=()=>({first:()=>({json:cfg})});
const store={telegramInitialized:true};

const messaggi=[
  'mario@esempio.it limone piemonte',
  'a@b.com, c@d.it garessio',
  'MARIO@Esempio.IT   Torino',
  'x@y.it bordi',
  'x@y.it genoa',
  'solo-testo-senza-email torino',
  'x@y.it',
  'x@y.it montecarlo',
  'nonunamail@ torino',
  '/start',
];
const updates=messaggi.map((t,i)=>({update_id:1000+i,message:{chat:{id:99},from:{id:7,username:'u'},text:t,date:9}}));

const letti=run(J('b02_richiesta.js'),$c,null,{$json:{result:updates},sd:()=>store});
const risolti=run(J('b03_risolvi_localita.js'),$c,{all:()=>letti});

console.log('MESSAGGIO'.padEnd(38),'ESITO');
console.log('-'.repeat(78));
risolti.forEach(r=>{
  const j=r.json;
  const esito = j.errore ? `ERRORE: ${j.errore}` : `-> ${j.citta.nome} [${j.citta.profilo}] a ${j.emails.join(', ')}`;
  console.log(('"'+j.text+'"').padEnd(38), esito);
});
console.log(`\n(su ${messaggi.length} messaggi, "/start" e' ignorato: ${risolti.length} item prodotti)`);

console.log('\n--- risposte Telegram per le richieste sbagliate ---');
const errati=risolti.filter(r=>r.json.errore);
run(J('b10_messaggio_errore.js'),null,{all:()=>errati}).forEach(m=>{
  console.log('\n> ' + m.json.testo.replace(/\n/g,'\n  '));
});
