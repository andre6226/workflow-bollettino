const fs=require('fs'); const SP=process.env.SP;
const run=(body,$,input)=>new Function('$','$input','return (function(){'+body+'})();')($,input);
const cfg=run(fs.readFileSync(SP+'/js/b00_config.js','utf8'),null,null)[0].json;
const risolte=JSON.parse(fs.readFileSync(SP+'/fixture/risolte.json','utf8'));
const AGG=fs.readFileSync(SP+'/js/b05_aggregatore.js','utf8');

for (const r of risolte) {
  const om=JSON.parse(fs.readFileSync(SP+`/fixture/om_${r.citta.id}.json`,'utf8'));
  const contesto={...r, ufficiale_ok:true, ufficiale_clean:'(finto)'};
  const $=(n)=>({first:()=>({json: n==='0. Config'?cfg:contesto})});
  const out=run(AGG,$,{first:()=>({json:om})})[0].json;

  console.log('='.repeat(78));
  console.log(`${r.citta.nome}  (${r.citta.profilo}, quota reale ${r.citta.quota} m, griglia ${out.quota_modello} m)`);
  const g=out.giorni_previsti[0];
  const s=out.raw_stats[g];
  console.log(`  giorni: ${out.giorni_previsti.join(' ')}`);
  console.log(`  ${g}: T ${s.tmin}/${s.tmax}°C  cielo=${s.cielo}  pioggia=${s.rain_tot}mm  vento=${s.dir} ${s.wind}(${s.gust})km/h`);
  console.log(`     convezione=${s.convezione}  CAPE=${s.cape_max}  shear=${s.shear_ms} m/s`);
  const fen=[];
  if ('nebbia' in s) fen.push(`nebbia=${s.nebbia||'-'} foschia=${s.foschia||'-'} visMin=${s.vis_min}m`);
  if ('foehn' in s) fen.push(`foehn=${s.foehn||'-'}`);
  if ('inversione' in s) fen.push(`inversione=${s.inversione||'-'}`);
  if ('neve' in s || 'neve_cm' in s) fen.push(`neve=${s.neve_cm}cm zero=${s.zero_termico_min}-${s.zero_termico_max}m`);
  console.log('     fenomeni: ' + (fen.length?fen.join(' | '):'(nessuno, profilo costa)'));
  // controllo: nessun fenomeno fuori profilo
  const attesi=r.fenomeni;
  const presenti=[];
  if ('nebbia' in s) presenti.push('nebbia');
  if ('foehn' in s) presenti.push('foehn');
  if ('inversione' in s) presenti.push('inversione');
  if ('neve_cm' in s) presenti.push('neve');
  const ok = JSON.stringify([...presenti].sort())===JSON.stringify([...attesi].sort());
  console.log(`     profilo rispettato: ${ok?'SI':'NO ('+presenti+' vs '+attesi+')'}`);
  console.log(`     prompt modelli: ${out.dati_modelli.length} char`);
}
