export function initialState(){return {title:'Projektwoche',open:false,projects:Array.from({length:9},(_,i)=>({id:String(i+1),title:`Angebot ${i+1}`,description:'Beschreibung folgt.',capacity:[12,12]})),children:[],assignments:{},fixed:[],planStatus:'draft'};}
export function validatePlan(state,plan,{allowOutside=false,complete=false}={}){
 const counts=state.projects.map(()=>[0,0]);const issues=[];
 for(const child of state.children){const pair=plan[child.id]||[null,null];if(!Array.isArray(pair)||pair.length!==2){issues.push('Ungültige Zuteilung.');continue;}if(pair[0]&&pair[0]===pair[1])issues.push(`${child.id}: zweimal derselbe Posten.`);
  pair.forEach((id,b)=>{if(!id){if(complete)issues.push(`${child.id}: Block ${b+1} fehlt.`);return;}const i=state.projects.findIndex(p=>p.id===id);if(i<0){issues.push('Unbekannter Posten.');return;}counts[i][b]++;if(!allowOutside&&!child.choices.includes(id))issues.push(`${child.id}: Angebot nicht gewählt.`);});
 }
 state.projects.forEach((p,i)=>[0,1].forEach(b=>{if(counts[i][b]>p.capacity[b])issues.push(`${p.title}: zu viele Kinder in Block ${b+1}.`);}));return {issues,counts};
}
// Successive shortest augmenting paths, convex seat costs favour equal groups.
function match(children,projects,block,excluded,fixed,seed){
 const n=children.length,source=0,childStart=1,projectStart=n+1,sink=projectStart+projects.length,g=Array.from({length:sink+1},()=>[]),out={};
 function edge(u,v,cap,cost){const a={to:v,rev:g[v].length,cap,cost},b={to:u,rev:g[u].length,cap:0,cost:-cost};g[u].push(a);g[v].push(b);return a;}
 const used=projects.map(()=>0);for(const c of children){if(fixed[c.id]){out[c.id]=fixed[c.id];const j=projects.findIndex(p=>p.id===fixed[c.id]);if(j>=0)used[j]++;}}
 const links=[];children.forEach((c,i)=>{if(out[c.id])return;edge(source,childStart+i,1,0);c.choices.forEach(id=>{const j=projects.findIndex(p=>p.id===id);if(j<0||excluded[c.id]===id)return;const tie=((i+1)*17+(j+1)*31+seed*(i+7)*(j+3))%19;links.push({id:c.id,project:id,e:edge(childStart+i,projectStart+j,1,tie)});});});
 projects.forEach((p,j)=>{for(let k=used[j];k<p.capacity[block];k++)edge(projectStart+j,sink,1,k*100);});
 for(;;){const d=Array(g.length).fill(Infinity),prev=Array(g.length),queue=[source],inQ=Array(g.length).fill(false);d[source]=0;inQ[source]=true;for(let q=0;q<queue.length;q++){const u=queue[q];inQ[u]=false;g[u].forEach((e,i)=>{if(e.cap&&d[e.to]>d[u]+e.cost){d[e.to]=d[u]+e.cost;prev[e.to]=[u,i];if(!inQ[e.to]){inQ[e.to]=true;queue.push(e.to);}}});}if(!prev[sink])break;for(let v=sink;v!==source;){const[u,i]=prev[v],e=g[u][i];e.cap--;g[v][e.rev].cap++;v=u;}}
 for(const l of links)if(!l.e.cap)out[l.id]=l.project;return out;
}
export function allocate(state){
 let best=null,bestScore=Infinity;const fixed=[{},{}];for(const id of state.fixed){const pair=state.assignments[id];if(pair)pair.forEach((p,b)=>{if(p)fixed[b][id]=p;});}
 const fixedPlan=Object.fromEntries(state.fixed.map(id=>[id,state.assignments[id]]));if(validatePlan(state,fixedPlan,{allowOutside:true}).issues.length)throw Error('Fixierte Zuteilungen prüfen.');
 for(let seed=1;seed<=24;seed++){const first=seed%2,second=1-first;const a=match(state.children,state.projects,first,fixed[second],fixed[first],seed),b=match(state.children,state.projects,second,a,fixed[second],seed+3);const plan={};let missing=0;for(const c of state.children){plan[c.id]=first===0?[a[c.id]||null,b[c.id]||null]:[b[c.id]||null,a[c.id]||null];missing+=plan[c.id].filter(x=>!x).length;}const {counts}=validatePlan(state,plan,{allowOutside:true});const score=missing*1e6+counts.flat().reduce((s,n)=>s+n*n,0);if(score<bestScore){best=plan;bestScore=score;}}
 return {plan:best,missing:Object.values(best).flat().filter(x=>!x).length};
}
