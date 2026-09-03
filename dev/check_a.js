const fs=require('fs'), path=require('path');
const ROOT=path.resolve(__dirname,'..');
const wf=JSON.parse(fs.readFileSync(path.join(ROOT,'workflow_bollettini.json'),'utf8'));
let bad=0;
for(const n of wf.nodes){
  const code=n.parameters?.jsCode; if(!code) continue;
  try{ new Function('$','$input','$json','"use strict"; return (async function(){'+code+'})'); console.log('OK   ',n.name); }
  catch(e){ console.log('ERR  ',n.name,'->',e.message); bad++; }
}
console.log(bad?`\n${bad} ERRORI`:'\ntutti i nodi code compilano');
