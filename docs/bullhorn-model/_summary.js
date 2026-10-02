const fs=require("fs");const dir=__dirname;
const ents=["Candidate","ClientContact","ClientCorporation","JobOrder","JobSubmission","Placement","Opportunity","Lead"];
for(const e of ents){
  const m=JSON.parse(fs.readFileSync(dir+"/"+e+".json","utf8"));
  const cust=(m.fields||[]).filter(f=>/^custom/i.test(f.name)&&f.label&&!/^Custom\s|^Text Box|^Custom Text|^Custom Int|^Custom Float|^Custom Date|^Custom Encrypted|^Custom Object/i.test(f.label)&&f.label!==f.name);
  console.log("== "+e+" custom fields ("+cust.length+"): "+cust.map(f=>f.name+"='"+f.label+"'"+(f.options?"["+f.options.length+" opts]":"")).join("; "));
  const st=(m.fields||[]).find(f=>f.name==="status");
  if(st) console.log("   status options: "+(st.options||[]).map(o=>o.value).join(" | "));
}
const js=JSON.parse(fs.readFileSync(dir+"/JobSubmission.json","utf8"));
console.log("\nJobSubmission core fields: "+js.fields.filter(f=>!/^custom/i.test(f.name)).map(f=>f.name).join(", "));
const pl=JSON.parse(fs.readFileSync(dir+"/Placement.json","utf8"));
console.log("\nPlacement non-custom fields: "+pl.fields.filter(f=>!/^custom/i.test(f.name)).map(f=>f.name).join(", "));
const jo=JSON.parse(fs.readFileSync(dir+"/JobOrder.json","utf8"));
console.log("\nJobOrder non-custom fields: "+jo.fields.filter(f=>!/^custom/i.test(f.name)).map(f=>f.name).join(", "));
