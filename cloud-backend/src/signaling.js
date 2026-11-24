import {WebSocketServer} from "ws";
import jwt from "jsonwebtoken";
const peers=new Map();
export function attachSignaling(server){
 const wss=new WebSocketServer({server,path:"/v1/calls"});
 wss.on("connection",(ws,req)=>{const token=new URL(req.url,"http://localhost").searchParams.get("token");let user;
 try{user=jwt.verify(token,process.env.JWT_SECRET,{issuer:"bitvoid-cloud"});}catch{ws.close(1008,"Unauthorized");return;}
 ws.userId=user.sub;ws.username=user.username;const set=peers.get(user.sub)||new Set();set.add(ws);peers.set(user.sub,set);
 ws.send(JSON.stringify({type:"connected",userId:user.sub}));
 ws.on("message",(raw)=>{let msg;try{msg=JSON.parse(raw.toString());}catch{return;}
 if(!["call-offer","call-answer","ice-candidate","call-end","call-reject"].includes(msg.type))return;
 if(typeof msg.to!=="string"||!msg.to||typeof msg.payload!=="object")return;const targets=peers.get(msg.to);if(!targets)return;
 const relay={type:msg.type,from:user.sub,fromUsername:user.username,payload:msg.payload,callId:String(msg.callId||"").slice(0,100),sentAt:Date.now()};
 for(const peer of targets)if(peer.readyState===1)peer.send(JSON.stringify(relay));});
 ws.on("close",()=>{const current=peers.get(user.sub);current?.delete(ws);if(!current?.size)peers.delete(user.sub);});
 });return wss;
}
