import { writeFile, mkdir } from 'node:fs/promises';
const dir=new URL('../data/demo/',import.meta.url);await mkdir(dir,{recursive:true});
const node=(id,parentId,name,partNumber,quantity=1,refDes=[],extra={})=>({id,parentId,occurrenceKey:`demo:${id}`,name,partNumber,revision:'A',quantity,unit:'EA',refDes,records:[],...extra});
const nodes=[
  node('engine',null,'Demonstrator engine','DEMO-1000'),
  node('feed','engine','Propellant feed','DEMO-2000'),
  node('valve-ox','feed','Isolation valve · oxidizer','DEMO-2100',1,['V-OX-01']),
  node('valve-fuel','feed','Isolation valve · fuel','DEMO-2100',1,['V-FU-01']),
  node('sensor-feed','feed','Feed pressure transducer','DEMO-2200',2,['PT-101','PT-102']),
  node('filter','feed','Inlet filter','DEMO-2300'),
  node('line','feed','Feed line','DEMO-2400',1,[],{unit:'M',quantity:1.25}),
  node('power','engine','Power & controls','DEMO-3000'),
  node('controller','power','Controller module','DEMO-3100',1,['ECU-01']),
  node('harness','power','Primary harness','DEMO-3200',1,['WH-01']),
  node('bracket-p','power','Mounting bracket','DEMO-3300',4),
  node('thermal','engine','Thermal management','DEMO-4000'),
  node('shield','thermal','Thermal shield','DEMO-4100'),
  node('sensor-temp','thermal','Temperature probe','DEMO-4200',2,['TT-201','TT-202']),
  node('bracket-t','thermal','Mounting bracket','DEMO-3300',2),
  node('structure','engine','Primary structure','DEMO-5000'),
  node('frame','structure','Support frame','DEMO-5100'),
  node('fastener','structure','Mounting bolt','DEMO-5200',12),
];
// Explanatory records declare which change types they account for and, when serial-specific, the serial they apply to.
const record=(id,type,summary,relationship='explains',scope={})=>({id,type,summary,relationship,status:'Closed',source:'Synthetic quality system',...scope});
const base={id:'ebom-rA',name:'Demonstrator engine',partNumber:'DEMO-1000',revision:'A',source:'Teamcenter',type:'eBOM',releaseStatus:'Released',serialNumber:null,configuration:'Demo baseline · all units',capturedAt:'2026-10-09T13:00:00Z',synthetic:true,nodes};
const snapshots=[base];
function copy(id,type,rev,status,serial,source){return {...structuredClone(base),id,type,revision:rev,releaseStatus:status,serialNumber:serial,source,capturedAt:'2026-10-09T14:00:00Z'};}
function update(s,id,patch){Object.assign(s.nodes.find(n=>n.id===id),patch);}
const eb=copy('ebom-rB','eBOM','B','Unreleased',null,'Teamcenter');
update(eb,'valve-ox',{revision:'B',records:[record('DEMO-ECO-014','ECO','Valve revision update in the proposed engineering baseline.','explains',{changes:['Revision']})]});
update(eb,'controller',{revision:'B'});update(eb,'fastener',{quantity:16});
snapshots.push(eb);
const mb=copy('mbom-rA','mBOM','A','Released',null,'Teamcenter');
update(mb,'harness',{parentId:'structure'});update(mb,'fastener',{quantity:14});
mb.nodes.push(node('kit','structure','Installation kit','DEMO-5300'));
snapshots.push(mb);
const ab=copy('abom-sn120','aBOM','As built','Released','SN120','Manufacturo');
update(ab,'valve-ox',{partNumber:'DEMO-2110',revision:'C',name:'Isolation valve · alternate',records:[record('DEMO-NC-1042','NC','Explicit synthetic disposition authorizes alternate valve DEMO-2110 at V-OX-01 for SN120.','explains',{changes:['Replaced','Revision','Description'],serialNumber:'SN120'})]});
update(ab,'sensor-feed',{revision:'B',records:[record('DEMO-ECO-028','ECO','Synthetic engineering change updates feed transducers to revision B.','explains',{changes:['Revision']})]});
update(ab,'controller',{revision:'B'});update(ab,'fastener',{quantity:14,records:[record('DEMO-NC-1061','NC','Synthetic disposition adds two mounting bolts for this unit.','explains',{changes:['Quantity'],serialNumber:'SN120'})]});
update(ab,'harness',{parentId:'structure',records:[record('DEMO-WO-120','Work order','Harness installed in the structure work package.','related')]});
update(ab,'sensor-temp',{refDes:['TT-201','TT-203']});
ab.nodes=ab.nodes.filter(n=>n.id!=='filter');
ab.nodes.push(node('support','feed','Feed line support','DEMO-2500',1,[],{records:[record('DEMO-NC-1054','NC','Synthetic disposition adds feed line support to this serialized unit.','explains',{changes:['Added'],serialNumber:'SN120'})]}));
snapshots.push(ab);
const ab2=structuredClone(ab);ab2.id='abom-sn121';ab2.serialNumber='SN121';
update(ab2,'valve-ox',{partNumber:'DEMO-2100',revision:'A',name:'Isolation valve · oxidizer',records:[]});
update(ab2,'fastener',{quantity:12,records:[]});ab2.nodes=ab2.nodes.filter(n=>n.id!=='support');
update(ab2,'sensor-temp',{refDes:['TT-201','TT-202']});snapshots.push(ab2);
const ms=structuredClone(mb);ms.id='mbom-sn120';ms.serialNumber='SN120';ms.configuration='Demo baseline · SN120 manufacturing plan';snapshots.push(ms);
for(const s of snapshots)await writeFile(new URL(`${s.id}.json`,dir),JSON.stringify(s,null,2)+'\n');
console.log(`Wrote ${snapshots.length} synthetic snapshots`);
