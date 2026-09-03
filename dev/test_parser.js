const fs=require('fs'); const SP=process.env.SP;
const body=fs.readFileSync(SP+'/js/a03_parser_bollettino.js','utf8');

// simula i due item che arrivano insieme dal ramo di estrazione
const meta=[
  {json:{regione:'liguria', provider:'arpal', last_modified:'Tue, 01 Sep 2026 10:34:03 GMT', precedente:null}},
  {json:{regione:'piemonte',provider:'arpa_piemonte', last_modified:'Tue, 01 Sep 2026 21:35:05 GMT', precedente:{bollettino:'278/2026'}}}
];
const items=[
  {json:{text:fs.readFileSync(SP+'/fixture/arpal_raw.txt','utf8')}},
  {json:{text:fs.readFileSync(SP+'/fixture/pie.txt','utf8')}}
];
const $=(n)=>({all:()=>meta});
const res=new Function('$','$input','return (function(){'+body+'})();')($,{all:()=>items});

res.forEach(r=>{
  const j=r.json, o=JSON.parse(j.testo_bollettino);
  console.log('='.repeat(76));
  console.log(`${j.provider.padEnd(14)} ok=${j.ok} boll=${j.bollettino} cambiato=${j.cambiato}`);
  console.log('  giorni  :', Object.keys(o.by_date).join(', '));
  console.log('  tendenza:', Object.keys(o.tendenza).join(', '));
  console.log('  clean   :', o.clean.length, 'char | riga tabella:', j.testo_bollettino.length, 'char');
  if (j.nota) console.log('  nota    :', j.nota);
});
console.log('\n>> il secondo ha lo stesso numero di bollettino gia salvato: deve dare cambiato=false');
