import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adminLogin, adminSetup, adminSetupRequired, destroyAdminSession, getAdminSession } from "./admin-auth.js";

const here=path.dirname(fileURLToPath(import.meta.url));
const webDir=path.resolve(here,"../dashboard");
const readAsset=name=>fs.readFileSync(path.join(webDir,name));
const cookieName="bv_admin";
const cookieValue=req=>String(req.headers.cookie||"").split(";").map(v=>v.trim()).find(v=>v.startsWith(cookieName+"="))?.slice(cookieName.length+1)||"";
const setCookie=(reply,token)=>reply.header("Set-Cookie",cookieName+"="+token+"; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=43200");
const clearCookie=reply=>reply.header("Set-Cookie",cookieName+"=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0");
const auth=(req,reply,done)=>{ const session=getAdminSession(cookieValue(req)); if(!session)return reply.code(401).send({error:"unauthorized"}); req.admin=session; done(); };
const activity=(db,event,detail)=>db.prepare("INSERT INTO admin_activity(event,detail,created_at) VALUES(?,?,?)").run(event,String(detail||"").slice(0,240),new Date().toISOString());

export function registerAdminRoutes(app,db,sockets,serverInfo) {
  const attempts=new Map();
  app.get("/admin",async(_req,reply)=>reply.type("text/html; charset=utf-8").send(readAsset("index.html")));
  app.get("/admin/assets/dashboard.css",async(_req,reply)=>reply.type("text/css; charset=utf-8").send(readAsset("dashboard.css")));
  app.get("/admin/assets/dashboard.js",async(_req,reply)=>reply.type("text/javascript; charset=utf-8").send(readAsset("dashboard.js")));
  app.get("/admin/api/session",async(req,reply)=>{const session=getAdminSession(cookieValue(req));return {authenticated:!!session,username:session?.username||null,setupRequired:adminSetupRequired()};});
  app.post("/admin/api/setup",async(req,reply)=>{
    try { if(!adminSetupRequired())return reply.code(409).send({error:"setup_complete"}); const account=adminSetup(req.body?.setupCode,req.body?.username,req.body?.password); activity(db,"admin.created",account.username); const login=adminLogin(account.username,req.body.password); setCookie(reply,login.token); return {ok:true,username:login.username}; }
    catch(e){return reply.code(e.statusCode||400).send({error:e.message});}
  });
  app.post("/admin/api/login",async(req,reply)=>{
    const ip=req.ip||"unknown", now=Date.now(), state=attempts.get(ip)||{count:0,until:0};
    if(state.until>now&&state.count>=8)return reply.code(429).send({error:"Too many login attempts. Try again in 15 minutes."});
    const result=adminLogin(req.body?.username,req.body?.password);
    if(!result){state.count++;if(state.count>=8)state.until=now+15*60*1000;attempts.set(ip,state);return reply.code(401).send({error:"Incorrect username or password."});}
    attempts.delete(ip);setCookie(reply,result.token);activity(db,"admin.login",result.username);return {ok:true,username:result.username};
  });
  app.post("/admin/api/logout",{preHandler:auth},async(req,reply)=>{destroyAdminSession(cookieValue(req));activity(db,"admin.logout",req.admin.username);clearCookie(reply);return {ok:true};});
  app.get("/admin/api/overview",{preHandler:auth},async()=>{
    const users=db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
    const devices=db.prepare("SELECT COUNT(*) AS n FROM devices").get().n;
    const conversations=db.prepare("SELECT COUNT(*) AS n FROM conversations").get().n;
    const messages=db.prepare("SELECT COUNT(*) AS n FROM messages").get().n;
    const onlineUserIds=[...sockets.keys()].filter(id=>(sockets.get(id)?.size||0)>0);
    const online=onlineUserIds.length;
    const recentMessages=db.prepare("SELECT substr(created_at,1,13) AS hour,COUNT(*) AS count FROM messages WHERE created_at>=? GROUP BY hour ORDER BY hour").all(new Date(Date.now()-24*60*60*1000).toISOString());
    const hourly=Array.from({length:24},(_,i)=>{const d=new Date(Date.now()-(23-i)*3600000);const key=d.toISOString().slice(0,13);return {label:d.toLocaleTimeString("en",{hour:"2-digit",hour12:false}),count:recentMessages.find(r=>r.hour===key)?.count||0};});
    const userRows=db.prepare("SELECT id,username,device_id AS deviceId,created_at AS createdAt FROM users ORDER BY created_at DESC").all().map(u=>({...u,online:(sockets.get(u.id)?.size||0)>0,connections:sockets.get(u.id)?.size||0}));
    const deviceRows=db.prepare("SELECT d.id,d.created_at AS createdAt,d.last_seen AS lastSeen,u.username FROM devices d LEFT JOIN users u ON u.device_id=d.id ORDER BY d.last_seen DESC").all().map(d=>({...d,online:userRows.some(u=>u.deviceId===d.id&&u.online)}));
    const activityRows=db.prepare("SELECT id,event,detail,created_at AS createdAt FROM admin_activity ORDER BY id DESC LIMIT 12").all();
    return {server:{name:serverInfo.name,uptimeSeconds:Math.floor(process.uptime()),nodeVersion:process.version,platform:process.platform,startedAt:new Date(Date.now()-process.uptime()*1000).toISOString()},stats:{users,online,devices,onlineDevices:deviceRows.filter(d=>d.online).length,conversations,messages,nodes:1},messagesPerHour:hourly,users:userRows,devices:deviceRows,activity:activityRows,services:[{name:"HTTP API",status:"Operational"},{name:"WebSocket",status:"Operational"},{name:"SQLite",status:"Operational"},{name:"ESP-12E gateway",status:process.env.BITVOID_GATEWAY_URL?"Configured":"Not reporting"}]};
  });
  app.get("/admin/api/users",{preHandler:auth},async()=>({users:db.prepare("SELECT u.id,u.username,u.device_id AS deviceId,u.created_at AS createdAt,d.last_seen AS lastSeen FROM users u LEFT JOIN devices d ON d.id=u.device_id ORDER BY u.created_at DESC").all().map(u=>({...u,online:[...sockets.keys()].some(id=>id===u.id&&(sockets.get(id)?.size||0)>0)}))}));
  app.get("/admin/api/devices",{preHandler:auth},async()=>({devices:db.prepare("SELECT d.id,d.created_at AS createdAt,d.last_seen AS lastSeen,u.username FROM devices d LEFT JOIN users u ON u.device_id=d.id ORDER BY d.last_seen DESC").all()}));
  app.get("/admin/api/nodes",{preHandler:auth},async()=>({nodes:[{id:"bv-pc-server",name:serverInfo.name,type:"PC coordinator",status:"online",address:"localhost",role:"Coordinator"},{id:"esp12e-gateway",name:"ESP-12E Wi-Fi gateway",type:"ESP8266 SoftAP",status:process.env.BITVOID_GATEWAY_URL?"configured":"not-reporting",address:process.env.BITVOID_GATEWAY_URL||"Not configured",role:"Network gateway"}]}));
  app.get("/admin/api/activity",{preHandler:auth},async()=>({activity:db.prepare("SELECT id,event,detail,created_at AS createdAt FROM admin_activity ORDER BY id DESC LIMIT 100").all()}));
  app.log.info("BitVoid admin dashboard routes registered");
}
export { activity as logAdminActivity };
