/* Trace a logo into a filled glyph path.
   usage: node _trace.js <file.png> <mode>
     mode "light"  keep the light mark off a coloured ground
     mode "dark"   keep the dark mark off a light ground            */
const sharp=require('sharp'), fs=require('fs');
const SP='C:/Users/bring/AppData/Local/Temp/claude/C--Users-bring-Downloads-miralodash/3f7f6b27-4f38-479d-894b-71dc122e29fd/scratchpad';
const N=384, idx=(x,y)=>y*N+x;
function fill(m){const out=new Uint8Array(m),seen=new Uint8Array(N*N),st=[];
 for(let x=0;x<N;x++)st.push(idx(x,0),idx(x,N-1)); for(let y=0;y<N;y++)st.push(idx(0,y),idx(N-1,y));
 while(st.length){const p=st.pop(); if(seen[p]||m[p])continue; seen[p]=1; const x=p%N,y=(p/N)|0;
  if(x>0)st.push(p-1); if(x<N-1)st.push(p+1); if(y>0)st.push(p-N); if(y<N-1)st.push(p+N);}
 for(let i=0;i<N*N;i++) if(!m[i]&&!seen[i]) out[i]=1; return out;}
function comps(m){const lab=new Int32Array(N*N).fill(-1),out=[];
 for(let i=0;i<N*N;i++){ if(!m[i]||lab[i]>=0)continue; const id=out.length,st=[i],c=[]; lab[i]=id;
  while(st.length){const q=st.pop(); c.push(q); const x=q%N,y=(q/N)|0;
   for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy; if(nx<0||ny<0||nx>=N||ny>=N)continue;
    const r=idx(nx,ny); if(m[r]&&lab[r]<0){lab[r]=id;st.push(r);}}}
  out.push(c);} return out;}
function contours(m){const at=(x,y)=>(x<0||y<0||x>=N||y>=N)?0:m[idx(x,y)];
 const seen=new Set(),paths=[],dirs=[[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
 for(let y=0;y<N;y++)for(let x=0;x<N;x++){ if(!at(x,y))continue;
  if(!(!at(x-1,y)||!at(x+1,y)||!at(x,y-1)||!at(x,y+1))||seen.has(idx(x,y)))continue;
  const pts=[]; let cx=x,cy=y,d=6,g=0;
  do{ pts.push([cx,cy]); seen.add(idx(cx,cy)); let f=false;
   for(let k=0;k<8;k++){const nd=(d+6+k)%8,nx=cx+dirs[nd][0],ny=cy+dirs[nd][1];
    if(at(nx,ny)){cx=nx;cy=ny;d=nd;f=true;break;}}
   if(!f)break;}while(!(cx===x&&cy===y)&&++g<200000);
  if(pts.length>10){paths.push(pts);
   const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
   console.log('  contour '+pts.length+'px  x'+Math.min(...xs)+'-'+Math.max(...xs)+' y'+Math.min(...ys)+'-'+Math.max(...ys));}
 } return paths;}
/* Average the contour before simplifying.
   The source is 200px and gets sampled up, so thresholding its
   anti-aliased edge leaves stair-steps a pixel high. Douglas-Peucker
   keeps those — they are real vertices — and they show up as a wobble
   along every edge. A short moving average removes the steps without
   moving the line. */
function smooth(p,passes,k){ let q=p;
 for(let n=0;n<passes;n++){ const o=[];
  for(let i=0;i<q.length;i++){ let sx=0,sy=0;
   for(let j=-k;j<=k;j++){const t=q[(i+j+q.length*2)%q.length]; sx+=t[0]; sy+=t[1];}
   o.push([sx/(2*k+1), sy/(2*k+1)]); }
  q=o; }
 return q;}
function simp(p,e){ if(p.length<3)return p;
 const d2=(q,a,b)=>{const[x,y]=q,[x1,y1]=a,[x2,y2]=b,dx=x2-x1,dy=y2-y1,L=dx*dx+dy*dy;
  if(!L)return (x-x1)**2+(y-y1)**2; let t=((x-x1)*dx+(y-y1)*dy)/L; t=Math.max(0,Math.min(1,t));
  return (x-(x1+t*dx))**2+(y-(y1+t*dy))**2;};
 const keep=new Uint8Array(p.length); keep[0]=keep[p.length-1]=1; const st=[[0,p.length-1]];
 while(st.length){const[a,b]=st.pop(); let mi=-1,md=0;
  for(let i=a+1;i<b;i++){const d=d2(p[i],p[a],p[b]); if(d>md){md=d;mi=i;}}
  if(md>e*e){keep[mi]=1;st.push([a,mi],[mi,b]);}}
 return p.filter((_,i)=>keep[i]);}
function toPath(pts,s,o){const P=pts.map(([x,y])=>[+(x*s+o[0]).toFixed(2),+(y*s+o[1]).toFixed(2)]);
 const n=P.length; if(n<3)return ''; let d=`M${P[0][0]} ${P[0][1]}`;
 for(let i=0;i<n;i++){const p0=P[(i-1+n)%n],p1=P[i],p2=P[(i+1)%n],p3=P[(i+2)%n];
  const c1=[p1[0]+(p2[0]-p0[0])/6,p1[1]+(p2[1]-p0[1])/6],c2=[p2[0]-(p3[0]-p1[0])/6,p2[1]-(p3[1]-p1[1])/6];
  d+=`C${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${p2[0]} ${p2[1]}`;}
 return d+'Z';}
(async()=>{
const file=process.argv[2], mode=process.argv[3]||'light', eps=+(process.argv[4]||0.8), THR=+(process.argv[5]||58), SM=+(process.argv[6]||0);
/* The letterbox has to be the logo's OWN background, or it gets read as
   part of the mark. Mid-grey passes the 'ring' brightness test and came
   back as a white band across the bottom of the glyph. */
const PAD = (mode==='bright') ? '#000000' : '#ffffff';
/* Optional pre-blur. A low-resolution source thresholds into
   stair-steps; blurring BEFORE the threshold turns those steps into a
   gradient the threshold cuts cleanly through. It smooths the edge
   rather than the polygon, so corners stay where they are. */
let img=sharp(file).resize(N,N,{fit:'contain',background:PAD}).flatten({background:PAD});
if(SM) img=img.blur(SM);
const {data,info}=await img.raw().toBuffer({resolveWithObject:true});
const ch=info.channels, P=i=>[data[i*ch],data[i*ch+1],data[i*ch+2]];
const lum=(r,g,b)=>0.299*r+0.587*g+0.114*b;
let m=new Uint8Array(N*N);
for(let i=0;i<N*N;i++){const[r,g,b]=P(i);
 m[i]= mode==='light'  ? (lum(r,g,b)>200&&Math.max(r,g,b)-Math.min(r,g,b)<40?1:0)
     : mode==='bright' ? (lum(r,g,b)>THR?1:0)         /* any mark off a dark ground */
     : mode==='colour' ? (Math.max(r,g,b)-Math.min(r,g,b)>THR?1:0)  /* a coloured mark off white */
     /* A mark whose own INTERIOR is dark: keep the saturated rim and any
        bright detail, drop the dark plate so it cuts a hole. */
     : mode==='ring'   ? (!(r>235&&g>235&&b>235) && (Math.max(r,g,b)-Math.min(r,g,b)>45 || lum(r,g,b)>THR) ? 1:0)
                       : (lum(r,g,b)<110?1:0); }
{const cs=comps(m).filter(c=>c.length>N*N*0.0006); const k=new Uint8Array(N*N);
 for(const c of cs)for(const p of c)k[p]=1; m=k; console.log('parts kept',cs.length);}
{const inv=new Uint8Array(N*N); for(let i=0;i<N*N;i++)inv[i]=m[i]?0:1;
 console.log('background components:', comps(inv).filter(c=>c.length>40).length);
 const b=Buffer.alloc(N*N*3); for(let i=0;i<N*N;i++){const v=m[i]?255:24;b[i*3]=b[i*3+1]=b[i*3+2]=v;}
 await sharp(b,{raw:{width:N,height:N,channels:3}}).png().toFile(SP+'/m1.png');}
let x0=1e9,y0=1e9,x1=-1,y1=-1;
for(let y=0;y<N;y++)for(let x=0;x<N;x++) if(m[idx(x,y)]){if(x<x0)x0=x;if(y<y0)y0=y;if(x>x1)x1=x;if(y>y1)y1=y;}
const w=x1-x0,h=y1-y0,s=21/Math.max(w,h);
const off=[1.5+(21-w*s)/2-x0*s,1.5+(21-h*s)/2-y0*s];
const D=contours(m).map(c=>toPath(simp(smooth(c,SM?4:2,SM?4:3),eps),s,off)).filter(Boolean);
console.log('contours',D.length,'bbox',w+'x'+h);
const d=D.join(' ');
fs.writeFileSync('_glyph.json',JSON.stringify({d}));
const g=(px,tx,ty)=>`<g transform="translate(${tx},${ty}) scale(${px/24})" fill="#fff" fill-rule="evenodd"><path d="${d}"/></g>`;
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="516" height="256"><rect width="100%" height="100%" fill="#18181b"/>${g(232,12,12)}${g(17.5,300,120)}${g(30,330,113)}${g(48,375,104)}${g(72,435,92)}</svg>`;
await sharp(Buffer.from(svg)).png().toFile(SP+'/p1.png');
const c=[{input:await sharp(SP+'/p1.png').toBuffer(),left:0,top:0},
 {input:await sharp(file).resize(256,256,{fit:'contain',background:'#18181b'}).toBuffer(),left:520,top:0}];
await sharp({create:{width:776,height:256,channels:3,background:'#18181b'}}).composite(c).png().toFile(SP+'/cmp.png');
console.log('rendered');
})();
