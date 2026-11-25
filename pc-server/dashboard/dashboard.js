const $=id=>document.getElementById(id);
let overview=null,activePage="overview",refreshTimer=null,mediaRows=[],mediaLimits=null;
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const date=value=>value?new Date(value).toLocaleString():"—";
const ago=value=>{if(!value)return"—";const ms=Date.now()-new Date(value).getTime();if(ms<60000)return"just now";if(ms<3600000)return Math.floor(ms/60000)+"m ago";if(ms<86400000)return Math.floor(ms/3600000)+"h ago";return Math.floor(ms/86400000)+"d ago";};
async function api(path,options={}){const response=await fetch("/admin/api/"+path,{credentials:"same-origin",headers:{"Content-Type":"application/json",...(options.headers||{})},...options});let data={};try{data=await response.json()}catch{}if(!response.ok)throw new Error(data.error||"Request failed");return data;}
function showLogin(setup){$("loginView").classList.remove("hidden");$("appView").classList.add("hidden");$("setupLabel").classList.toggle("hidden",!setup);const setupInput=document.querySelector('input[name="setupCode"]');setupInput.required=setup;setupInput.disabled=!setup;$("loginTitle").textContent=setup?"Create your administrator":"Welcome back";$("loginDescription").textContent=setup?"Use the one-time setup code printed in the PC server terminal.":"Sign in to your server control center.";$("loginButton").textContent=setup?"Create admin account":"Sign in securely";$("loginForm").dataset.mode=setup?"setup":"login";}
function showApp(username){$("loginView").classList.add("hidden");$("appView").classList.remove("hidden");$("adminName").textContent=username||"Administrator";loadDashboard();if(refreshTimer)clearInterval(refreshTimer);refreshTimer=setInterval(loadDashboard,5000);}
async function boot(){try{const s=await api("session");if(s.authenticated)showApp(s.username);else showLogin(s.setupRequired);}catch{showLogin(false);}}
$("loginForm").addEventListener("submit",async e=>{e.preventDefault();$("loginError").textContent="";const f=new FormData(e.currentTarget),body={username:f.get("username"),password:f.get("password")};try{const setup=e.currentTarget.dataset.mode==="setup";if(setup)body.setupCode=f.get("setupCode");const result=await api(setup?"setup":"login",{method:"POST",body:JSON.stringify(body)});showApp(result.username);}catch(error){$("loginError").textContent=error.message;}});
$("logoutButton").addEventListener("click",async()=>{try{await api("logout",{method:"POST"})}catch{}if(refreshTimer)clearInterval(refreshTimer);showLogin(false);});
$("refreshButton").addEventListener("click",()=>loadDashboard());
document.querySelectorAll(".nav[data-page]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.page)));
document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.goto)));
function navigate(page){activePage=page;document.querySelectorAll(".nav[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===page));document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));$(page+"Page").classList.remove("hidden");const labels={overview:"Server overview",users:"User management",devices:"Device management",conversations:"Conversations & groups",media:"Media & files",nodes:"Network nodes",activity:"Activity log",settings:"Server settings"};$("pageName").textContent=page[0].toUpperCase()+page.slice(1);$("pageTitle").textContent=labels[page];if(page==="nodes")loadNodes();if(page==="activity")loadActivity();if(page==="users")loadUsers();if(page==="devices")loadDevices();if(page==="conversations")loadConversations();if(page==="media")loadMedia();if(page==="settings")loadSettings();}
async function loadDashboard(){try{overview=await api("overview");renderOverview();$("lastUpdated").textContent=new Date().toLocaleTimeString();}catch(error){if(error.message==="unauthorized"){if(refreshTimer)clearInterval(refreshTimer);showLogin(false);}}}
function renderOverview(){const s=overview.stats;$("statUsers").textContent=s.users;$("statOnline").textContent=s.online;$("statDevices").textContent=s.devices;$("statConversations").textContent=s.conversations;$("statNodes").textContent=s.nodes;$("navUsers").textContent=s.users;$("messageTotal").textContent=s.messages;$("uptime").textContent=duration(overview.server.uptimeSeconds);$("serverMeta").textContent=overview.server.nodeVersion+" · "+overview.server.platform;$("footerVersion").textContent=overview.server.nodeVersion;
$("serviceList").innerHTML=overview.services.map(x=>`<div class="service-row"><span>${esc(x.name)}</span><span class="service-state ${x.status==="Operational"?"":"warn"}">${esc(x.status)}</span></div>`).join("");
$("recentUsers").innerHTML=overview.users.slice(0,6).map(userRow).join("")||emptyRow(4,"No users registered yet");$("recentActivity").innerHTML=overview.activity.slice(0,6).map(activityItem).join("")||'<p class="muted tiny">No activity has been recorded yet.</p>';drawChart();if(activePage==="users")loadUsers();if(activePage==="devices")loadDevices();if(activePage==="nodes")loadNodes();}
function duration(sec){const d=Math.floor(sec/86400),h=Math.floor(sec%86400/3600),m=Math.floor(sec%3600/60);return(d?d+"d ":"")+(h+"h "+m+"m");}
function userRow(u){return`<tr><td><div class="user-cell"><span class="user-avatar">${esc((u.username||"?")[0].toUpperCase())}</span>${esc(u.username)}</div></td><td>${esc(u.deviceId||"—")}</td><td><span class="status ${u.online?"online":"offline"}">${u.online?"Online":"Offline"}</span></td><td>${esc(date(u.createdAt))}</td></tr>`;}
function emptyRow(cols,msg){return`<tr><td colspan="${cols}" class="muted">${msg}</td></tr>`;}
function drawChart(){const canvas=$("trafficChart");if(!canvas)return;const rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1,w=Math.max(300,rect.width),h=190;canvas.width=w*dpr;canvas.height=h*dpr;const ctx=canvas.getContext("2d");ctx.scale(dpr,dpr);const values=overview.messagesPerHour.map(x=>x.count),max=Math.max(4,...values),left=25,right=8,top=12,bottom=25,plotW=w-left-right,plotH=h-top-bottom;ctx.font="9px sans-serif";ctx.fillStyle="#8B949E";ctx.strokeStyle="#283240";ctx.lineWidth=1;for(let i=0;i<=4;i++){const y=top+plotH*i/4;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.fillText(String(Math.round(max*(4-i)/4)),2,y+3);}const step=plotW/Math.max(1,values.length);ctx.beginPath();values.forEach((v,i)=>{const x=left+i*step+step/2,y=top+plotH-(v/max)*plotH;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)});ctx.lineTo(left+plotW,top+plotH);ctx.lineTo(left,top+plotH);ctx.closePath();const grad=ctx.createLinearGradient(0,top,0,top+plotH);grad.addColorStop(0,"rgba(0,255,156,.28)");grad.addColorStop(1,"rgba(0,255,156,0)");ctx.fillStyle=grad;ctx.fill();ctx.beginPath();values.forEach((v,i)=>{const x=left+i*step+step/2,y=top+plotH-(v/max)*plotH;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)});ctx.strokeStyle="#00FF9C";ctx.lineWidth=2;ctx.stroke();ctx.fillStyle="#8B949E";[0,5,11,17,23].forEach(i=>{const x=left+i*step+step/2;ctx.fillText(overview.messagesPerHour[i].label,x-7,h-7)});}
function activityItem(a){const symbols={"user.registered":"♙","message.sent":"✉","device.paired":"▣","device.revoked":"⛔","group.renamed":"✎","group.member_removed":"−","media.deleted":"▤","admin.login":"↪","admin.logout":"↩","admin.created":"✦"};return`<div class="activity-item"><div class="activity-symbol">${symbols[a.event]||"◦"}</div><div><b>${esc(a.event.replaceAll("."," ").replace(/\b\w/g,c=>c.toUpperCase()))}</b><small>${esc(a.detail)} · ${esc(ago(a.createdAt))}</small></div></div>`;}
async function loadUsers(){if(!overview)return;const q=($("userSearch").value||"").toLowerCase();const users=overview.users||[];$("usersTable").innerHTML=users.filter(u=>(u.username+" "+u.id+" "+u.deviceId).toLowerCase().includes(q)).map(u=>`<tr><td><div class="user-cell"><span class="user-avatar">${esc(u.username[0].toUpperCase())}</span>${esc(u.username)}</div></td><td>${esc(u.id)}</td><td>${esc(u.deviceId)}</td><td><span class="status ${u.online?"online":"offline"}">${u.online?"Online":"Offline"}</span></td><td>${esc(date(u.createdAt))}</td></tr>`).join("")||emptyRow(5,"No matching users");}
async function loadDevices(){
 if(!overview)return;
 const q=($("deviceSearch").value||"").toLowerCase(),devices=overview.devices||[];
 $("devicesTable").innerHTML=devices.filter(d=>(d.id+" "+(d.username||"")).toLowerCase().includes(q)).map(d=>'<tr><td>'+esc(d.id)+'</td><td>'+esc(d.username||"Unassigned")+'</td><td><span class="status '+(d.revokedAt?"offline":d.online?"online":"offline")+'">'+(d.revokedAt?"Revoked":d.online?"Online":"Offline")+'</span></td><td>'+esc(ago(d.lastSeen))+'</td><td>'+esc(date(d.createdAt))+'</td><td>'+(d.revokedAt?'<span class="muted tiny">Re-pair required</span>':'<button class="danger-btn revoke-device" data-id="'+esc(d.id)+'">Revoke access</button>')+'</td></tr>').join("")||emptyRow(6,"No paired devices");
 document.querySelectorAll(".revoke-device").forEach(button=>button.addEventListener("click",()=>revokeDevice(button.dataset.id)));
}
async function revokeDevice(id){
 if(!window.confirm("Revoke this device now? Its current session and connected WebSocket will be disconnected. The device must be paired again to regain access."))return;
 try{await api("devices/"+encodeURIComponent(id)+"/revoke",{method:"POST"});await loadDashboard();}
 catch(e){window.alert("Could not revoke device: "+e.message);}
}
async function loadNodes(){try{const data=await api("nodes");$("nodesGrid").innerHTML=data.nodes.map(n=>{const t=n.telemetry||{};const details=[["Node ID",n.id],["Role",n.role],["Address / endpoint",n.address],["Reporting",n.status==="online"?"Live":n.status==="not-configured"?"Not configured":n.status==="checking"?"Checking":"Offline"]];if(t.gatewayId)details.push(["Gateway ID",t.gatewayId],["Wi-Fi SSID",t.ssid],["Connected clients",t.clients+" / "+t.maxClients],["Uptime",duration(t.uptimeSeconds)],["Free heap",Math.round(t.freeHeapBytes/1024)+" KB"],["MAC address",t.mac],["ESP8266 core",t.coreVersion],["Last seen",n.lastSeenAt?date(n.lastSeenAt):"—"],["Last checked",n.checkedAt?date(n.checkedAt):"—"],["Response time",n.latencyMs+" ms"]);else details.push(["Last seen",n.lastSeenAt?date(n.lastSeenAt):"Never"],["Last check",n.checkedAt?date(n.checkedAt):"—"],["Diagnostic",n.error||"Waiting for gateway response."]);return `<article class="node-card"><div class="node-head"><div><h3>${esc(n.name)}</h3><p>${esc(n.type)}</p></div><span class="node-type">${esc(n.status)}</span></div><div class="node-details">${details.map(([k,v])=>`<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div></article>`}).join("");}catch(e){$("nodesGrid").textContent=e.message;}}
async function loadActivity(){try{const data=await api("activity");$("activityTable").innerHTML=data.activity.map(a=>activityItem(a)).join("")||'<p class="muted">No activity yet.</p>';}catch(e){$("activityTable").textContent=e.message;}}
let conversationRows=[],selectedConversationId=null;
async function loadConversations(){try{const data=await api("conversations");conversationRows=data.conversations||[];renderConversations();}catch(e){$("conversationsTable").innerHTML=emptyRow(7,esc(e.message));}}
function renderConversations(){
 const q=($("conversationSearch").value||"").toLowerCase();
 const rows=conversationRows.filter(c=>((c.title||"")+" "+c.type+" "+(c.creator||"")+" "+c.id).toLowerCase().includes(q));
 $("conversationsTable").innerHTML=rows.map(c=>'<tr><td>'+esc(c.type)+'</td><td><button class="text-btn inspect-conversation" data-id="'+esc(c.id)+'">'+esc(c.title||"Direct conversation")+'</button></td><td>'+esc(c.creator||"Unknown")+'</td><td>'+c.memberCount+'</td><td>'+c.messageCount+'</td><td>'+esc(ago(c.lastMessageAt))+'</td><td>'+esc(date(c.createdAt))+'</td></tr>').join("")||emptyRow(7,"No conversations found");
 document.querySelectorAll(".inspect-conversation").forEach(button=>button.addEventListener("click",()=>inspectConversation(button.dataset.id)));
}
async function inspectConversation(id){
 $("conversationTitle").textContent="Loading conversation…";$("conversationMeta").textContent=id;
 try{const data=await api("conversations/"+encodeURIComponent(id)+"/messages");const row=conversationRows.find(c=>c.id===id);
 selectedConversationId=id;
 $("conversationTitle").textContent=row?.title||"Direct conversation";$("conversationMeta").textContent=(row?.type||"conversation")+" · "+(data.members?.length||0)+" members · "+(data.messages?.length||0)+" recent messages";
 const isGroup=row?.type==="group";$("conversationAdminControls").classList.toggle("hidden",!isGroup);
 if(isGroup){
  $("groupTitleInput").value=row?.title||"";$("groupAdminMessage").textContent="You can rename this group and remove members. A group must retain at least one member."; 
  $("conversationMembers").innerHTML=(data.members||[]).map(m=>'<span class="member-chip">'+esc(m.username)+' <button class="member-remove" data-user-id="'+esc(m.id)+'" data-username="'+esc(m.username)+'" aria-label="Remove '+esc(m.username)+'">×</button></span>').join("")||'<span class="muted tiny">No members</span>';
  document.querySelectorAll(".member-remove").forEach(button=>button.addEventListener("click",()=>removeGroupMember(id,button.dataset.userId,button.dataset.username)));
 }else{$("conversationMembers").innerHTML=(data.members||[]).map(m=>'<span class="member-chip">'+esc(m.username)+'</span>').join("")||'<span class="muted tiny">No members</span>';}
 $("conversationMessages").innerHTML=(data.messages||[]).map(m=>'<div class="activity-item"><div class="activity-symbol">✉</div><div><b>'+esc(m.sender||"Unknown member")+'</b><small>'+esc(date(m.createdAt))+'</small><p class="message-preview">'+esc(m.body)+'</p></div></div>').join("")||'<p class="muted tiny">No messages in this conversation.</p>';
 }catch(e){$("conversationTitle").textContent="Unable to load conversation";$("conversationMeta").textContent=e.message;}
}
async function saveGroupTitle(){
 const id=selectedConversationId;if(!id)return;
 const title=$("groupTitleInput").value.trim();$("groupAdminMessage").textContent="";
 try{const result=await api("conversations/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify({title})});const row=conversationRows.find(c=>c.id===id);if(row)row.title=result.title;renderConversations();$("conversationTitle").textContent=result.title;$("groupAdminMessage").textContent="Group name updated.";}
 catch(e){$("groupAdminMessage").textContent="Could not update group: "+e.message;}
}
async function removeGroupMember(conversationId,userId,username){
 if(!window.confirm("Remove "+username+" from this group? They will no longer be a member of this conversation."))return;
 $("groupAdminMessage").textContent="";
 try{await api("conversations/"+encodeURIComponent(conversationId)+"/members/"+encodeURIComponent(userId),{method:"DELETE"});await inspectConversation(conversationId);$("groupAdminMessage").textContent=username+" was removed from the group.";}
 catch(e){$("groupAdminMessage").textContent="Could not remove member: "+e.message;}
}
$("saveGroupTitleButton").addEventListener("click",saveGroupTitle);
$("groupTitleInput").addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();saveGroupTitle();}});
function formatBytes(bytes){
 if(bytes<1024)return bytes+" B";
 if(bytes<1024*1024)return (bytes/1024).toFixed(1)+" KB";
 return (bytes/1024/1024).toFixed(2)+" MB";
}
async function loadMedia(){
 try{
  const data=await api("media");mediaRows=data.files||[];mediaLimits=data.limits||{};
  const used=data.totals?.bytes||0,totalLimit=mediaLimits.maxTotalStorageBytes||0;
  $("mediaCount").textContent=data.totals?.count??mediaRows.length;
  $("mediaStorage").textContent=formatBytes(used);
  $("mediaQuotaUsed").textContent=formatBytes(used)+" / "+formatBytes(totalLimit);
  $("mediaQuotaPercent").textContent=(totalLimit?Math.min(100,used/totalLimit*100):0).toFixed(1)+"% used";
  $("mediaQuotaBar").style.width=(totalLimit?Math.min(100,used/totalLimit*100):0)+"%";
  $("mediaQuotaBar").setAttribute("aria-valuenow",String(totalLimit?Math.min(100,used/totalLimit*100):0));
  $("mediaConversationLimit").textContent=formatBytes(mediaLimits.maxConversationStorageBytes||0);
  $("mediaDailyLimit").textContent=formatBytes(mediaLimits.maxUserDailyUploadBytes||0);
  $("mediaFileLimit").textContent=formatBytes(mediaLimits.maxFileBytes||0);
  renderMedia();
 }catch(error){$("mediaTable").innerHTML=emptyRow(7,esc(error.message));}
}
function renderMedia(){
 const q=($("mediaSearch").value||"").toLowerCase();
 const rows=mediaRows.filter(f=>[f.name,f.mimeType,f.conversationTitle,f.conversationId,f.sender].join(" ").toLowerCase().includes(q));
 $("mediaTable").innerHTML=rows.map(f=>'<tr><td><div class="media-file"><span class="media-file-icon">'+(f.mimeType.startsWith("image/")?"▧":f.mimeType.startsWith("video/")?"▶":f.mimeType.startsWith("audio/")?"♫":"▤")+'</span><div><b>'+esc(f.name)+'</b><small>'+esc(f.id.slice(0,8))+'</small></div></div></td><td>'+esc(f.mimeType)+'</td><td>'+esc(f.conversationTitle||f.conversationId)+' <small class="muted">'+esc(f.type)+'</small></td><td>'+esc(f.sender)+'</td><td>'+formatBytes(f.sizeBytes)+'</td><td>'+esc(date(f.createdAt))+'</td><td><button class="danger-btn delete-media" data-id="'+esc(f.id)+'" data-name="'+esc(f.name)+'">Delete</button></td></tr>').join("")||emptyRow(7,"No matching attachments");
 document.querySelectorAll(".delete-media").forEach(button=>button.addEventListener("click",()=>deleteMedia(button.dataset.id,button.dataset.name)));
}
async function deleteMedia(id,name){
 if(!window.confirm("Permanently delete "+name+"? All members of its conversation will lose access."))return;
 try{await api("media/"+encodeURIComponent(id),{method:"DELETE"});await loadMedia();}
 catch(error){window.alert("Could not delete file: "+error.message);}
}
async function loadSettings(){
 try{const data=await api("settings"),s=data.server,g=data.integrations.gateway,c=data.integrations.cloud,sec=data.security;
 const rows=pairs=>pairs.map(([k,v])=>'<div><span>'+esc(k)+'</span><b>'+esc(v??"—")+'</b></div>').join("");
 $("serverSettings").innerHTML=rows([["Server name",s.name],["Bind address",s.host],["Port",s.port],["Node.js",s.nodeVersion],["Platform",s.platform],["State directory",s.stateDirectory],["Uptime",duration(s.uptimeSeconds)]]);
 $("cloudStatus").textContent=c.configured?"CONFIGURED":"NOT CONFIGURED";$("cloudSettings").innerHTML=rows([["Sync endpoint",c.url||"Not configured"],["Node ID",c.nodeId],["Shared secret",c.configured?"Configured · hidden":"Not configured"]]);
 $("gatewaySettings").innerHTML=rows([["Gateway status",g.status],["Endpoint",g.endpoint],["Credentials",g.configured?"Configured · hidden":"Not configured"]]);$("gatewayDiagnostic").textContent=g.error||"Gateway status is healthy.";
 $("securitySettings").innerHTML=rows([["Admin session",sec.adminSessionHours+" hours"],["Session cookie",sec.sessionCookie],["Network scope","Local network"],["HTTPS","Not configured"]]);
 }catch(e){$("serverSettings").textContent=e.message;}
}
$("checkGatewayButton").addEventListener("click",async()=>{const button=$("checkGatewayButton");button.disabled=true;button.textContent="Checking…";try{await api("nodes/gateway/check",{method:"POST"});await loadSettings();if(activePage==="nodes")await loadNodes();button.textContent="Check now ↻";}catch(e){$("gatewayDiagnostic").textContent=e.message;button.textContent="Retry ↻";}finally{button.disabled=false;}});
$("userSearch").addEventListener("input",loadUsers);$("deviceSearch").addEventListener("input",loadDevices);$("conversationSearch").addEventListener("input",renderConversations);$("mediaSearch").addEventListener("input",renderMedia);$("refreshMediaButton").addEventListener("click",loadMedia);
window.addEventListener("resize",()=>{if(overview)drawChart();});
boot();
