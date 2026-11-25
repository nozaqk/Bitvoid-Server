import fs from "node:fs";
import { createHash, randomBytes } from "node:crypto";
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
  app.get("/admin/assets/bitvoid-logo.jpg",async(_req,reply)=>reply.type("image/jpeg").send(readAsset("assets/bitvoid-logo.jpg")));
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
    const deviceRows=db.prepare("SELECT d.id,d.created_at AS createdAt,d.last_seen AS lastSeen,d.revoked_at AS revokedAt,u.username FROM devices d LEFT JOIN users u ON u.device_id=d.id ORDER BY d.last_seen DESC").all().map(d=>({...d,online:userRows.some(u=>u.deviceId===d.id&&u.online)}));
    const activityRows=db.prepare("SELECT id,event,detail,created_at AS createdAt FROM admin_activity ORDER BY id DESC LIMIT 12").all();
    return {server:{name:serverInfo.name,uptimeSeconds:Math.floor(process.uptime()),nodeVersion:process.version,platform:process.platform,startedAt:new Date(Date.now()-process.uptime()*1000).toISOString()},stats:{users,online,devices,onlineDevices:deviceRows.filter(d=>d.online).length,conversations,messages,nodes:2},messagesPerHour:hourly,users:userRows,devices:deviceRows,activity:activityRows,services:[{name:"HTTP API",status:"Operational"},{name:"WebSocket",status:"Operational"},{name:"SQLite",status:"Operational"},{name:"ESP-12E gateway",status:serverInfo.gatewayMonitor?.getSnapshot().status==="online"?"Online":serverInfo.gatewayMonitor?.getSnapshot().status==="checking"?"Checking":serverInfo.gatewayMonitor?.getSnapshot().status==="not-configured"?"Not configured":"Offline"}],gateway:serverInfo.gatewayMonitor?.getSnapshot()||{status:"not-configured",configured:false,telemetry:null,error:"Gateway monitor unavailable."}};
  });
  app.get("/admin/api/users",{preHandler:auth},async()=>({users:db.prepare("SELECT u.id,u.username,u.device_id AS deviceId,u.created_at AS createdAt,d.last_seen AS lastSeen FROM users u LEFT JOIN devices d ON d.id=u.device_id ORDER BY u.created_at DESC").all().map(u=>({...u,online:[...sockets.keys()].some(id=>id===u.id&&(sockets.get(id)?.size||0)>0)}))}));
  app.get("/admin/api/devices",{preHandler:auth},async()=>({devices:db.prepare("SELECT d.id,d.created_at AS createdAt,d.last_seen AS lastSeen,d.revoked_at AS revokedAt,u.username FROM devices d LEFT JOIN users u ON u.device_id=d.id ORDER BY d.last_seen DESC").all()}));
  app.post("/admin/api/devices/:id/revoke",{preHandler:auth},async(req,reply)=>{
    const device=db.prepare("SELECT id,revoked_at AS revokedAt FROM devices WHERE id=?").get(req.params.id);
    if(!device)return reply.code(404).send({error:"device_not_found"});
    if(device.revokedAt)return {ok:true,alreadyRevoked:true};
    const revokedAt=new Date().toISOString();
    const replacementHash=createHash("sha256").update(randomBytes(32)).digest("hex");
    db.prepare("UPDATE devices SET revoked_at=?,token_hash=? WHERE id=?").run(revokedAt,replacementHash,device.id);
    const user=db.prepare("SELECT id,username FROM users WHERE device_id=?").get(device.id);
    if(user){
      for(const socket of sockets.get(user.id)||[])if(socket.readyState===1)socket.close(1008,"Device access revoked by administrator");
      sockets.delete(user.id);
    }
    activity(db,"device.revoked",device.id+(user?" · "+user.username:""));
    return {ok:true,deviceId:device.id,revokedAt};
  });
  app.get("/admin/api/nodes",{preHandler:auth},async()=>{
    const gateway=serverInfo.gatewayMonitor?.getSnapshot()||{status:"not-configured",configured:false,telemetry:null,error:"Gateway monitor unavailable."};
    const t=gateway.telemetry;
    return {nodes:[
      {id:"bv-pc-server",name:serverInfo.name,type:"PC coordinator",status:"online",address:"localhost",role:"Coordinator"},
      {id:"esp12e-gateway",name:"ESP-12E Wi-Fi gateway",type:"ESP8266 SoftAP",status:gateway.status,address:t?.ip||gateway.endpoint||"Not configured",role:"Network gateway",
       checkedAt:gateway.checkedAt,lastSeenAt:gateway.lastSeenAt,latencyMs:gateway.latencyMs,error:gateway.error,
       telemetry:t?{gatewayId:t.gatewayId,hostname:t.hostname,ssid:t.ssid,ip:t.ip,mac:t.mac,clients:t.clients,maxClients:t.maxClients,uptimeSeconds:t.uptimeSeconds,freeHeapBytes:t.freeHeapBytes,chipId:t.chipId,flashBytes:t.flashBytes,coreVersion:t.coreVersion}:null}
    ]};
  });
  app.get("/admin/api/conversations",{preHandler:auth},async()=>{
    const rows=db.prepare(`SELECT c.id,c.type,c.title,c.created_at AS createdAt,c.created_by AS createdBy,u.username AS creator,
      (SELECT COUNT(*) FROM conversation_members m WHERE m.conversation_id=c.id) AS memberCount,
      (SELECT COUNT(*) FROM messages x WHERE x.conversation_id=c.id) AS messageCount,
      (SELECT MAX(created_at) FROM messages x WHERE x.conversation_id=c.id) AS lastMessageAt
      FROM conversations c LEFT JOIN users u ON u.id=c.created_by ORDER BY COALESCE((SELECT MAX(x.created_at) FROM messages x WHERE x.conversation_id=c.id),c.created_at) DESC`).all();
    return {conversations:rows};
  });
  app.get("/admin/api/conversations/:id/messages",{preHandler:auth},async(req,reply)=>{
    const exists=db.prepare("SELECT id FROM conversations WHERE id=?").get(req.params.id);
    if(!exists)return reply.code(404).send({error:"conversation_not_found"});
    const messages=db.prepare(`SELECT m.id,m.sender_id AS senderId,u.username AS sender,m.body,m.created_at AS createdAt
      FROM messages m LEFT JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=? ORDER BY m.created_at DESC LIMIT 100`).all(req.params.id).reverse();
    const members=db.prepare(`SELECT u.id,u.username,m.joined_at AS joinedAt FROM conversation_members m JOIN users u ON u.id=m.user_id WHERE m.conversation_id=? ORDER BY m.joined_at`).all(req.params.id);
    return {messages,members};
  });
  app.patch("/admin/api/conversations/:id",{preHandler:auth},async(req,reply)=>{
    const conversation=db.prepare("SELECT id,type,title FROM conversations WHERE id=?").get(req.params.id);
    if(!conversation)return reply.code(404).send({error:"conversation_not_found"});
    if(conversation.type!=="group")return reply.code(409).send({error:"only_groups_can_be_renamed"});
    const title=String(req.body?.title||"").trim().slice(0,80);
    if(title.length<1)return reply.code(400).send({error:"group_name_required"});
    db.prepare("UPDATE conversations SET title=? WHERE id=?").run(title,conversation.id);
    activity(db,"group.renamed",conversation.id+" · "+title);
    return {ok:true,id:conversation.id,title};
  });
  app.delete("/admin/api/conversations/:id/members/:userId",{preHandler:auth},async(req,reply)=>{
    const conversation=db.prepare("SELECT id,type,title FROM conversations WHERE id=?").get(req.params.id);
    if(!conversation)return reply.code(404).send({error:"conversation_not_found"});
    if(conversation.type!=="group")return reply.code(409).send({error:"members_can_only_be_removed_from_groups"});
    const member=db.prepare("SELECT u.id,u.username FROM conversation_members m JOIN users u ON u.id=m.user_id WHERE m.conversation_id=? AND m.user_id=?").get(conversation.id,req.params.userId);
    if(!member)return reply.code(404).send({error:"group_member_not_found"});
    const count=db.prepare("SELECT COUNT(*) AS n FROM conversation_members WHERE conversation_id=?").get(conversation.id).n;
    if(count<=1)return reply.code(409).send({error:"group_must_keep_at_least_one_member"});
    db.prepare("DELETE FROM conversation_members WHERE conversation_id=? AND user_id=?").run(conversation.id,member.id);
    activity(db,"group.member_removed",conversation.id+" · "+member.username);
    return {ok:true,conversationId:conversation.id,userId:member.id,username:member.username};
  });
  app.get("/admin/api/settings",{preHandler:auth},async()=>{
    const gateway=serverInfo.gatewayMonitor?.getSnapshot()||{status:"not-configured",configured:false,error:"Gateway monitor unavailable."};
    return {server:{name:serverInfo.name,host:process.env.HOST||"0.0.0.0",port:Number(process.env.PORT||8787),platform:process.platform,nodeVersion:process.version,stateDirectory:process.env.BITVOID_STATE_DIR||".state",uptimeSeconds:Math.floor(process.uptime())},
      integrations:{gateway:{configured:gateway.configured,status:gateway.status,endpoint:gateway.endpoint,error:gateway.error},cloud:{configured:Boolean(process.env.BITVOID_CLOUD_SYNC_URL&&String(process.env.BITVOID_SYNC_SECRET||"").length>=32),url:process.env.BITVOID_CLOUD_SYNC_URL||null,nodeId:process.env.BITVOID_CLOUD_NODE_ID||"bitvoid-campus-node"}},
      security:{adminSessionHours:12,sessionCookie:"HttpOnly · SameSite=Strict",localNetworkOnly:true,httpsConfigured:false}};
  });
  app.post("/admin/api/nodes/gateway/check",{preHandler:auth},async()=>{
    if(!serverInfo.gatewayMonitor)return {ok:false,status:"not-configured",error:"Gateway monitor unavailable."};
    await serverInfo.gatewayMonitor.check();
    return {ok:true,gateway:serverInfo.gatewayMonitor.getSnapshot()};
  });
  app.get("/admin/api/activity",{preHandler:auth},async()=>({activity:db.prepare("SELECT id,event,detail,created_at AS createdAt FROM admin_activity ORDER BY id DESC LIMIT 100").all()}));
  app.log.info("BitVoid admin dashboard routes registered");
}
export { activity as logAdminActivity };
