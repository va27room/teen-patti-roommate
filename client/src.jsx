import React,{useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {io} from "socket.io-client";
import "./style.css";
const socket=io(import.meta.env.VITE_SERVER_URL || window.location.origin);
const SU={H:"♥",D:"♦",C:"♣",S:"♠"};
function Card({c,small=false}){return <div className={"card "+(c&&(c.suit==="H"||c.suit==="D")?"red":"")+(small?" small":"")}>{c?<><b>{c.rank}</b><span>{SU[c.suit]}</span></>:"🂠"}</div>}
function App(){
 const [s,setS]=useState(null),[name,setName]=useState(""),[code,setCode]=useState(""),[chips,setChips]=useState(1000),[bet,setBet]=useState(""),[msg,setMsg]=useState("");
 useEffect(()=>{socket.on("state",setS);socket.on("errorMsg",setMsg);return()=>{socket.off("state");socket.off("errorMsg")}},[]);
 if(!s)return <main className="login"><div className="glass"><div className="brand">♠ <span>PRIVATE TABLE</span></div><h1>Teen Patti</h1><p>Play privately with your roommates.</p><input placeholder="Your name" value={name} onChange={e=>setName(e.target.value)}/><input type="number" placeholder="Starting chips" value={chips} onChange={e=>setChips(e.target.value)}/><button onClick={()=>socket.emit("createRoom",{name,startingChips:chips})}>Create private room</button><div className="sep">OR JOIN</div><input placeholder="Room code" value={code} onChange={e=>setCode(e.target.value.toUpperCase())}/><button onClick={()=>socket.emit("joinRoom",{code,name})}>Join room</button>{msg&&<div className="error">{msg}</div>}</div></main>;
 const me=s.me,myTurn=s.turnId===me.id,side=s.sideshow, active=s.players.filter(p=>!p.dropped);
 let left=s.players[(s.players.findIndex(p=>p.id===me.id)+1)%s.players.length];
 const remembered=me.bet>0?me.bet:me.seen?2:1;
 const doBet=(n)=>{socket.emit("bet",{code:s.code,amount:n});setBet("")};
 const sidePending=side?.status==="pending"&&side.to===me.id, sideActive=side?.status==="active"&&(side.from===me.id||side.to===me.id);
 return <main><header><div><div className="brand">♠ PRIVATE TABLE</div><h1>Teen Patti</h1><small>Room <b>{s.code}</b> • Share this code privately</small></div><div className="pot">₹{s.pot}<small>POT</small></div></header>
 <div className="players">{s.players.map(p=><div className={"player "+(p.id===s.turnId?"active":"")} key={p.id}><div className="avatar">{p.name[0]}</div><div><b>{p.name}{p.id===me.id?" (You)":""}</b><small>{p.dropped?"Dropped":p.seen?"Seen":"Blind"} • ₹{p.chips}</small></div><span>₹{p.bet}</span></div>)}</div>
 <section className="table"><div className="tableglow"></div><div className="status">{s.started?(myTurn?"YOUR TURN":"Waiting for "+(s.players.find(p=>p.id===s.turnId)?.name||"player")):"ROUND NOT STARTED"}</div>
 <div className="mycards">{me.cards?me.cards.map((c,i)=><Card key={i} c={c}/>):[1,2,3].map(i=><Card key={i}/>)}</div>
 {s.started&&<div className="actions">{myTurn&&!sideActive&&<>{!me.seen&&<button onClick={()=>socket.emit("seeCards",{code:s.code})}>👁 See Cards</button>}<button className="primary" onClick={()=>doBet(remembered)}>💰 Bet ₹{remembered}</button><div className="custom"><input type="number" placeholder="Custom ₹" value={bet} onChange={e=>setBet(e.target.value)}/><button onClick={()=>doBet(Number(bet))}>Bet</button></div><button onClick={()=>socket.emit("requestSideShow",{code:s.code})} disabled={!me.seen||!left?.seen||me.chips<2}>👀 Side Show ₹2</button><button className="danger" onClick={()=>socket.emit("drop",{code:s.code})}>Drop</button></>}
 {sidePending&&<div className="modal"><b>👀 Side Show Request</b><p>{s.players.find(p=>p.id===side.from)?.name} wants to compare cards with you.</p><button className="primary" onClick={()=>socket.emit("respondSideShow",{code:s.code,accept:true})}>Accept</button><button onClick={()=>socket.emit("respondSideShow",{code:s.code,accept:false})}>Reject</button></div>}
 {sideActive&&<div className="modal"><b>SIDE SHOW</b><p>Compare your cards privately.</p><strong>40</strong><small> seconds</small></div>}
 </div>}
 {msg&&<div className="error">{msg}</div>}</section>
 {s.result&&<div className="result"><h2>🏆 {s.result.winnerName}</h2><p>{s.result.amount?"Won ₹"+s.result.amount:"Side Show result: "+s.result.hand}</p>{!s.started&&s.hostId===me.id&&<button className="primary" onClick={()=>socket.emit("startGame",{code:s.code})}>Start Next Round</button>}</div>}
 <div className="bottom"><button onClick={()=>{let n=prompt("Add virtual chips amount");if(n)socket.emit("rebuy",{code:s.code,amount:Number(n)})}}>＋ Add Chips</button><span>₹{s.settings.ante} ante/round • ₹2 Side Show fee • Virtual chips only</span></div>
 </main>
}
createRoot(document.getElementById("root")).render(<App/>);
