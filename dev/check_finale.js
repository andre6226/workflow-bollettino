const fs=require('fs'), path=require('path');
const ROOT=path.resolve(__dirname,'..');
let bad=0;
for (const f of ['workflow_bollettini.json','workflow_v3.json']) {
  const wf=JSON.parse(fs.readFileSync(path.join(ROOT,f),'utf8'));
  const nomi=wf.nodes.map(n=>n.name);
  console.log(`\n=== ${f}  (${wf.nodes.length} nodi, executionOrder=${wf.settings.executionOrder}, tz=${wf.settings.timezone})`);
  for(const n of wf.nodes){
    const code=n.parameters?.jsCode; if(!code) continue;
    try{ new Function('$','$input','$json','$env','$getWorkflowStaticData','$now',
        '"use strict"; return (async function(){'+code+'})'); }
    catch(e){ console.log('  ERR ',n.name,'->',e.message); bad++; continue; }
    // riferimenti a nodi
    for(const rif of [...code.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1])){
      if(!nomi.includes(rif)){ console.log(`  ERR  ${n.name}: $('${rif}') non esiste`); bad++; }
    }
  }
  // riferimenti dentro le espressioni dei parametri
  const testo=JSON.stringify(wf);
  for(const rif of [...testo.matchAll(/\\?\$\('([^']+)'\)/g)].map(m=>m[1])){
    if(!nomi.includes(rif)){ console.log(`  ERR espressione: $('${rif}') non esiste`); bad++; }
  }
  console.log('  code node e riferimenti: ' + (bad?'PROBLEMI':'ok'));
}
// segreti
const tutto=['workflow_bollettini.json','workflow_v3.json']
  .map(f=>fs.readFileSync(path.join(ROOT,f),'utf8')).join('');
console.log('\nsegreti nei file pubblicati:',
  /[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}|AIza[A-Za-z0-9_-]{30,}|AQ\.[A-Za-z0-9_-]{20,}/.test(tutto)
    ? 'PRESENTI (!!)' : 'nessuno');
process.exit(bad?1:0);
