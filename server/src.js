import express from "express";
import http from "http";
import cors from "cors";
import crypto from "crypto";
import {Server} from "socket.io";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app=express(); 
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || true }));
const httpServer=http.createServer(app);
const io=new Server(httpServer,{cors:{origin: process.env.ALLOWED_ORIGIN || true }});
const PORT=process.env.PORT||3001;
const STARTING_CHIPS=1000, ANTE=5, MAX=6, MIN=2, SIDESHOW_MS=40000;
const rooms=new Map();
const SUITS=["H","D","C","S"];
const RANKS=[["2",2],["3",3],["4",4],["5",5],["6",6],["7",7],["8",8],["9",9],["10",10],["J",11],["Q",12],["K",13],["A",14]];

const deck=()=>SUITS.flatMap(s=>RANKS.map(([rank,value])=>({rank,value,suit:s})));
function shuffle(a){for(let i=a.length-1;i>0;i--){let j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]]}return a}
function roomCode(){let c;do c=crypto.randomBytes(5).toString("hex").toUpperCase();while(rooms.has(c));return c}
function seqHigh(cards){let v=[...new Set(cards.map(c=>c.value))].sort((a,b)=>b-a);if(v.length!==3)return null;if(v[0]===14&&v[1]===3&&v[2]===2)return 14;if(v[0]-v[1]===1&&v[1]-v[2]===1)return v[0];return null}
function evalHand(cards){
 const vals=cards.map(c=>c.value).sort((a,b)=>b-a), flush=new Set(cards.map(c=>c.suit)).size===1, sh=seqHigh(cards);
 const cnt=Object.values(cards.reduce((m,c)=>(m[c.value]=(m[c.value]||0)+1,m),{})).sort((a,b)=>b-a);
 if(cnt[0]===3)return{cat:6,name:"Trail / Trio",tie:[vals[0]]};
 if(flush&&sh)return{cat:5,name:"Pure Sequence",tie:[sh]};
 if(sh)return{cat:4,name:"Sequence",tie:[new Set(cards.map(c=>c.suit)).size===3?1:0,sh]};
 if(flush)return{cat:3,name:"Color",tie:vals};
 if(cnt[0]===2){let pair=vals.find(v=>cards.filter(c=>c.value===v).length===2);return{cat:2,name:"Pair",tie:[pair,vals.find(v=>v!==pair)]}}
 return{cat:1,name:"High Card",tie:vals}
}
function cmp(a,b){let A=evalHand(a),B=evalHand(b);if(A.cat!==B.cat)return A.cat-B.cat;for(let i=0;i<Math.max(A.tie.length,B.tie.length);i++){let x=A.tie[i]||0,y=B.tie[i]||0;if(x!==y)return x-y}return 0}
function active(r){return r.players.filter(p=>!p.dropped)}
function next(r){if(active(r).length<=1)return finish(r);for(let n=1;n<=r.players.length;n++){let i=(r.turn+n)%r.players.length;if(!r.players[i].dropped){r.turn=i;return broadcast(r)}}}
function leftPlayer(r,p){
 let idx=r.players.findIndex(x=>x.id===p.id); if(idx<0)return null;
 for(let n=1;n<=r.players.length;n++){let x=r.players[(idx+n)%r.players.length];if(!x.dropped)return x}
}
function state(r,id){
 let p=r.players.find(x=>x.id===id);if(!p)return null;
 let ss=r.sideshow;
 let sideForMe=ss&&(ss.from===id||ss.to===id);
 return {code:r.code,hostId:r.hostId,started:r.started,pot:r.pot,turnId:r.started?r.players[r.turn]?.id:null,
  players:r.players.map(x=>({id:x.id,name:x.name,chips:x.chips,bet:x.bet,dropped:x.dropped,seen:x.seen})),
  me:{id:p.id,name:p.name,chips:p.chips,bet:p.bet,dropped:p.dropped,seen:p.seen,cards:p.seen||sideForMe?p.cards:null},
  sideshow:sideForMe?{from:ss.from,to:ss.to,status:ss.status,expiresAt:ss.expiresAt}:ss?{status:ss.status}:null,
  result:r.result,
  settings:{startingChips:r.startingChips,ante:ANTE,baseBlind:r.baseBlind}
 }
}
function broadcast(r){r.players.forEach(p=>io.to(p.id).emit("state",state(r,p.id)))}
function finish(r){
 if(r.sideshow){clearTimeout(r.sideshow.timer);r.sideshow=null}
 let a=active(r);if(!a.length)return;
 let w=a[0];for(let p of a.slice(1))if(cmp(p.cards,w.cards)>0)w=p;
 let result={winnerId:w.id,winnerName:w.name,hand:evalHand(w.cards).name,amount:r.pot,reason:a.length===1?"All other players dropped":"Final hand comparison",cards:w.cards};
 w.chips+=r.pot;r.pot=0;r.started=false;r.result=result;r.turn=0;broadcast(r)
}
function start(r){
 if(r.players.some(p=>p.chips<ANTE))return null;
 r.players.forEach(p=>{p.chips-=ANTE;p.bet=ANTE;p.dropped=false;p.seen=false});
 r.pot=ANTE*r.players.length;
 let d=shuffle(deck());r.players.forEach(p=>p.cards=[d.pop(),d.pop(),d.pop()]);
 r.turn=0;r.started=true;r.result=null;r.sideshow=null;broadcast(r)
}
function startSideShow(r,from,to){
 r.sideshow={from,to,status:"pending",expiresAt:Date.now()+10000,timer:null};
 broadcast(r);
 r.sideshow.timer=setTimeout(()=>{if(r.sideshow&&r.sideshow.status==="pending"){r.sideshow=null;broadcast(r)}},10000);
}
function acceptSide(r){
 let ss=r.sideshow;if(!ss)return;
 clearTimeout(ss.timer);ss.status="active";ss.expiresAt=Date.now()+SIDESHOW_MS;broadcast(r);
 ss.timer=setTimeout(()=>{
   if(!r.sideshow||r.sideshow.status!=="active")return;
   let A=r.players.find(p=>p.id===ss.from),B=r.players.find(p=>p.id===ss.to);
   let c=cmp(A.cards,B.cards);
   if(c<0)A.dropped=true; else if(c>0)B.dropped=true;
   r.result={type:"sideshow",winnerId:c<0?B.id:c>0?A.id:null,winnerName:c===0?"Tie":(c<0?B.name:A.name),hand:c===0?"Equal hands":(c<0?evalHand(B.cards).name:evalHand(A.cards).name)};
   r.sideshow=null;
   if(active(r).length<=1)finish(r);else next(r);
 },SIDESHOW_MS);
}
io.on("connection",s=>{
 s.on("createRoom",({name,startingChips})=>{
   let chips=Math.max(1,Number(startingChips)||STARTING_CHIPS),c=roomCode();
   let p={id:s.id,name:String(name||"Player").slice(0,20),chips,bet:0,dropped:false,seen:false,cards:[]};
   let r={code:c,hostId:s.id,players:[p],startingChips:chips,baseBlind:1,pot:0,turn:0,started:false,sideshow:null,result:null};
   rooms.set(c,r);s.join(c);broadcast(r)
 });
 s.on("joinRoom",({code,name})=>{
   let r=rooms.get(String(code||"").toUpperCase());if(!r)return s.emit("errorMsg","Room not found.");
   if(r.started)return s.emit("errorMsg","Round already running.");if(r.players.length>=MAX)return s.emit("errorMsg","Room is full.");
   r.players.push({id:s.id,name:String(name||"Player").slice(0,20),chips:r.startingChips,bet:0,dropped:false,seen:false,cards:[]});s.join(r.code);broadcast(r)
 });
 s.on("startGame",({code})=>{let r=rooms.get(code);if(!r||r.hostId!==s.id)return;if(r.players.length<MIN)return s.emit("errorMsg","At least 2 players are required.");if(!start(r))s.emit("errorMsg","Every player needs at least ₹5 to pay the round ante.")});
 s.on("seeCards",({code})=>{let r=rooms.get(code),p=r?.players.find(x=>x.id===s.id);if(!r||!p||!r.started||p.dropped||r.players[r.turn]?.id!==p.id)return;p.seen=true;broadcast(r)});
 s.on("drop",({code})=>{let r=rooms.get(code),p=r?.players.find(x=>x.id===s.id);if(!r||!p||!r.started||r.players[r.turn]?.id!==p.id||p.dropped)return;p.dropped=true;next(r)});
 s.on("bet",({code,amount})=>{
   let r=rooms.get(code),p=r?.players.find(x=>x.id===s.id);if(!r||!p||!r.started||r.players[r.turn]?.id!==p.id||p.dropped)return;
   let n=Number(amount), maxBlind=Math.max(3,r.baseBlind*3), min=p.seen?2:1;
   if(!Number.isFinite(n)||n<min||n>maxBlind||n>p.chips)return s.emit("errorMsg",`Allowed bet: ₹${min} to ₹${Math.min(maxBlind,p.chips)}.`);
   p.chips-=n;p.bet+=n;r.pot+=n;r.baseBlind=Math.max(r.baseBlind,n);next(r)
 });
 s.on("requestSideShow",({code})=>{
   let r=rooms.get(code),p=r?.players.find(x=>x.id===s.id);if(!r||!p||!r.started||r.players[r.turn]?.id!==p.id||!p.seen)return s.emit("errorMsg","Side Show requires you to be Seen.");
   let t=leftPlayer(r,p);if(!t||!t.seen)return s.emit("errorMsg","The player to your left must be Seen for Side Show.");
   startSideShow(r,p.id,t.id)
 });
 s.on("respondSideShow",({code,accept})=>{
   let r=rooms.get(code),ss=r?.sideshow;if(!r||!ss||ss.status!=="pending"||ss.to!==s.id)return;
   if(accept)acceptSide(r);else{clearTimeout(ss.timer);r.sideshow=null;broadcast(r)}
 });
 s.on("rebuy",({code,amount})=>{
   let r=rooms.get(code),p=r?.players.find(x=>x.id===s.id);if(!r||!p)return;
   let n=Number(amount);if(!Number.isFinite(n)||n<=0||n>100000)return s.emit("errorMsg","Invalid rebuy amount.");
   p.chips+=n;broadcast(r)
 });
 s.on("disconnect",()=>{for(let r of rooms.values()){let i=r.players.findIndex(p=>p.id===s.id);if(i<0)continue;r.players.splice(i,1);if(!r.players.length){rooms.delete(r.code);continue}if(r.hostId===s.id)r.hostId=r.players[0].id;if(r.sideshow&&(r.sideshow.from===s.id||r.sideshow.to===s.id)){clearTimeout(r.sideshow.timer);r.sideshow=null}if(r.started&&active(r).length<=1)finish(r);else broadcast(r)}}});
});

// Serve static files from client build directory
app.use(express.static(join(__dirname, '../client/dist')));

// Fallback to index.html for SPA routing
app.get("*",(_,res)=>res.sendFile(join(__dirname, '../client/dist/index.html')));

httpServer.listen(PORT,()=>console.log("Server on http://localhost:"+PORT));
