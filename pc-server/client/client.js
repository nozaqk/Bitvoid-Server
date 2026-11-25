const $=id=>document.getElementById(id);
const API="/api/v1";
let attachmentObjectUrls=[];
let token=localStorage.getItem("bitvoid.local.deviceToken")||"",deviceId=localStorage.getItem("bitvoid.local.deviceId")||("browser-"+Date.now()+"-"+Math.random().toString(36).slice(2)),user=null,active=null,conversations=[];
localStorage.setItem("bitvoid.local.deviceId",deviceId);
async function call(path,options={}){const headers={"Content-Type":"application/json",...(options.headers||{})};if(token)headers.Authorization="Bearer "+token;const response=await fetch(API+path,{...options,headers});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||data.error||"Request failed");return data}
function notice(message,good=false){$("notice").textContent=message;$("notice").style.color=good?"#72d9b6":"#ff9eaa"}
function showStep(step){$("pair-form").hidden=step!=="pair";$("approve-form").hidden=step!=="approve";$("register-form").hidden=step!=="register"}
async function initialize(){try{$("connection").textContent="Local server online";if(token){const me=await call("/me");if(me.user){user=me.user;showChat();return}showStep("register");return}showStep("pair")}catch(error){$("connection").textContent="Server unavailable";notice("Connect this device to the campus Wi-Fi and reload. "+error.message)}}
$("pair-form").addEventListener("submit",async e=>{e.preventDefault();try{const result=await call("/pairing/request",{method:"POST",body:JSON.stringify({deviceId})});window.pairingChallenge=result.challengeId;showStep("approve");notice("Pairing request created. Enter the administrator code from the PC terminal.",true)}catch(error){notice(error.message)}});
$("approve-form").addEventListener("submit",async e=>{e.preventDefault();try{const result=await call("/pairing/approve",{method:"POST",body:JSON.stringify({challengeId:window.pairingChallenge,adminCode:$("admin-code").value.trim()})});token=result.deviceToken;localStorage.setItem("bitvoid.local.deviceToken",token);showStep("register");notice("Device paired. Create your campus username.",true)}catch(error){notice(error.message)}});
$("register-form").addEventListener("submit",async e=>{e.preventDefault();try{const result=await call("/users/register",{method:"POST",body:JSON.stringify({username:$("username").value.trim()})});user={id:result.userId,username:result.username};showChat()}catch(error){notice(error.message)}});
function showChat(){$("setup-panel").hidden=true;$("chat-panel").hidden=false;$("welcome").textContent="Hello, "+user.username;loadConversations();refreshCloudStatus()}
async function refreshCloudStatus(){try{const data=await call("/cloud/status");$("cloud-state").textContent=data.identityStatus==="linked"?"Cloud account linked":"Local-only profile";$("cloud-copy").textContent=data.identityStatus==="linked"?"This campus profile is linked to "+(data.link?.cloudAccountId||"your cloud account")+". Sync status: "+(data.sync?.status||"waiting")+".":"Link an existing cloud account to use this identity outside campus. Cloud access requires internet.";if(data.identityStatus==="linked")$("cloud-form").hidden=true}catch(error){$("cloud-notice").textContent=error.message}}
$("cloud-form").addEventListener("submit",async e=>{e.preventDefault();$("cloud-notice").textContent="Checking cloud credentials and linking profile…";const button=$("cloud-form").querySelector("button");button.disabled=true;try{const result=await call("/cloud/link",{method:"POST",body:JSON.stringify({email:$("cloud-email").value.trim(),password:$("cloud-password").value})});$("cloud-password").value="";$("cloud-notice").textContent="Linked successfully. "+(result.applied?.applied||0)+" cloud updates applied.";await refreshCloudStatus()}catch(error){$("cloud-notice").textContent=error.message}finally{button.disabled=false}});

async function loadConversations(){try{const data=await call("/conversations");conversations=Array.isArray(data)?data:data.conversations||[];$("conversation-list").replaceChildren();for(const c of conversations){const b=document.createElement("button");b.className="conversation"+(active===c.id?" active":"");b.textContent=c.title||c.type+" conversation";b.addEventListener("click",()=>openConversation(c.id,b.textContent));$("conversation-list").append(b)}if(active){const c=conversations.find(x=>x.id===active);if(c)await openConversation(c.id,c.title||"Conversation")}}catch(error){notice(error.message)}}
async function openConversation(id,title){active=id;$("thread-title").textContent=title;$("message").disabled=false;$("send-form").querySelector("button").disabled=false;$("attachmentInput").disabled=false;$("uploadAttachmentButton").disabled=false;document.querySelectorAll(".conversation").forEach(b=>b.classList.toggle("active",b.textContent===title));try{const data=await call("/conversations/"+encodeURIComponent(id)+"/messages");$("messages").replaceChildren();for(const m of data.messages||[]){const el=document.createElement("div");el.className="message"+(m.senderId===user.id?" mine":"");const who=document.createElement("small");who.textContent=m.sender||"Member";const body=document.createElement("div");body.textContent=m.body;el.append(who,body);$("messages").append(el)}if(!data.messages?.length)$("messages").innerHTML='<p class="muted">No messages yet. Start the conversation.</p>';$("messages").scrollTop=$("messages").scrollHeight;await loadAttachments(id)}catch(error){notice(error.message)}}
function fileSize(bytes){return bytes<1024?bytes+" B":bytes<1024*1024?(bytes/1024).toFixed(1)+" KB":(bytes/1024/1024).toFixed(2)+" MB"}
async function loadAttachments(conversationId){
 const box=$("attachments");
 for(const url of attachmentObjectUrls)URL.revokeObjectURL(url);
 attachmentObjectUrls=[];
 box.replaceChildren();
 try{
  const data=await call("/conversations/"+encodeURIComponent(conversationId)+"/attachments");
  if(!data.attachments?.length){const empty=document.createElement("small");empty.className="muted";empty.textContent="No shared files yet.";box.append(empty);return}
  const title=document.createElement("strong");title.textContent="SHARED FILES";box.append(title);
  let previews=0;
  for(const file of data.attachments){
   const row=document.createElement("div");row.className="attachment-row";
   const info=document.createElement("div");const name=document.createElement("b");name.textContent=file.name;
   const meta=document.createElement("small");meta.textContent=file.sender+" · "+fileSize(file.sizeBytes);info.append(name,meta);
   const button=document.createElement("button");button.className="quiet";button.textContent="Download";button.addEventListener("click",()=>downloadAttachment(file.id,file.name));
   row.append(info,button);box.append(row);
   if(/^image\/(jpeg|png|webp|gif)$/.test(file.mimeType||"")&&file.sizeBytes<=3*1024*1024&&previews<12){
    previews++;
    const preview=document.createElement("div");preview.className="attachment-preview";
    const loading=document.createElement("small");loading.className="muted";loading.textContent="Loading image preview…";preview.append(loading);box.append(preview);
    fetch(API+"/attachments/"+encodeURIComponent(file.id),{headers:{Authorization:"Bearer "+token}})
     .then(response=>{if(!response.ok)throw new Error("Preview unavailable");return response.blob()})
     .then(blob=>{
      if(!blob.type.startsWith("image/"))throw new Error("Invalid image response");
      const url=URL.createObjectURL(blob);attachmentObjectUrls.push(url);
      const img=document.createElement("img");img.src=url;img.alt=file.name;img.loading="lazy";
      img.addEventListener("error",()=>{preview.replaceChildren();const error=document.createElement("small");error.className="muted";error.textContent="Image preview unavailable.";preview.append(error)},{once:true});
      preview.replaceChildren(img);
     })
     .catch(()=>{preview.replaceChildren();const error=document.createElement("small");error.className="muted";error.textContent="Image preview unavailable.";preview.append(error)});
   }
  }
 }catch(error){const msg=document.createElement("small");msg.className="muted";msg.textContent="Could not load shared files: "+error.message;box.append(msg)}
}
async function downloadAttachment(id,name){
 try{
  const response=await fetch(API+"/attachments/"+encodeURIComponent(id),{headers:{Authorization:"Bearer "+token}});
  if(!response.ok)throw new Error("Download failed");
  const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement("a");
  link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
 }catch(error){$("attachmentNotice").textContent=error.message}
}
$("uploadAttachmentButton").addEventListener("click",async()=>{
 const file=$("attachmentInput").files?.[0];if(!file||!active)return;
 if(file.size>8*1024*1024){$("attachmentNotice").textContent="Files must be 8 MB or smaller.";return}
 $("uploadAttachmentButton").disabled=true;$("attachmentNotice").textContent="Uploading…";
 try{
  const response=await fetch(API+"/conversations/"+encodeURIComponent(active)+"/attachments",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/octet-stream","X-BitVoid-File-Name":encodeURIComponent(file.name),"X-BitVoid-File-Type":file.type},body:file});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.message||result.error||"Upload failed");
  $("attachmentInput").value="";$("attachmentNotice").textContent="Uploaded "+result.name;
  await loadAttachments(active);
 }catch(error){$("attachmentNotice").textContent=error.message}
 finally{$("uploadAttachmentButton").disabled=false}
});
$("attachmentInput").addEventListener("change",()=>{
 const file=$("attachmentInput").files?.[0];$("attachmentNotice").textContent=file?file.name+" · "+fileSize(file.size):"";
});
$("new-chat").addEventListener("submit",async e=>{e.preventDefault();try{const data=await call("/conversations",{method:"POST",body:JSON.stringify({type:"direct",members:[$("member").value.trim()]})});active=data.id;$("member").value="";await loadConversations();await openConversation(data.id,"Direct conversation")}catch(error){notice(error.message)}});
$("send-form").addEventListener("submit",async e=>{e.preventDefault();const body=$("message").value.trim();if(!body||!active)return;try{await call("/conversations/"+encodeURIComponent(active)+"/messages",{method:"POST",body:JSON.stringify({body})});$("message").value="";await openConversation(active,"Conversation")}catch(error){notice(error.message)}});
$("disconnect").addEventListener("click",()=>{token="";user=null;active=null;localStorage.removeItem("bitvoid.local.deviceToken");$("chat-panel").hidden=true;$("setup-panel").hidden=false;showStep("pair");notice("This browser has been disconnected. Pair it again to use BitVoid.")});
initialize();