const API = (window.BITVOID_API_URL || "").replace(/\/$/,"") + "/api/v1";
const $ = id => document.getElementById(id);
let mode = "login", token = localStorage.getItem("bitvoid.cloud.token") || "", account = null, activeConversation = null, conversations = [];

async function request(path, options = {}) {
  const headers = { "Content-Type":"application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = "Bearer " + token;
  const response = await fetch(API + path, { ...options, headers });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.message || data.error || "Request failed.");
  return data;
}
function setNotice(message, good = false) { $("notice").textContent = message; $("notice").style.color = good ? "#72d9b6" : "#ff9eaa"; }
function setMode(next) {
  mode = next;
  document.querySelectorAll(".tab").forEach(tab=>tab.classList.toggle("active",tab.dataset.mode===mode));
  $("username-wrap").hidden = mode !== "register";
  $("username").required = mode === "register";
  $("password").autocomplete = mode === "register" ? "new-password" : "current-password";
  $("password-hint").textContent = mode === "register" ? "Use at least 12 characters. Your password is never synchronized to campus nodes." : "Use your BitVoid cloud account.";
  $("submit").innerHTML = mode === "register" ? "Create account <span>→</span>" : "Sign in <span>→</span>";
  setNotice("");
}
document.querySelectorAll(".tab").forEach(tab=>tab.addEventListener("click",()=>setMode(tab.dataset.mode)));
$("auth-form").addEventListener("submit",async event=>{
  event.preventDefault(); $("submit").disabled = true; setNotice("Connecting securely…");
  try {
    const payload = { email:$("email").value.trim(), password:$("password").value };
    if (mode === "register") payload.username = $("username").value.trim();
    const data = await request("/auth/" + (mode === "register" ? "register" : "login"), { method:"POST", body:JSON.stringify(payload) });
    token = data.token; account = data.account; localStorage.setItem("bitvoid.cloud.token",token); showChat();
  } catch(error) { setNotice(error.message); }
  finally { $("submit").disabled = false; }
});
function showChat() {
  $("auth-card").hidden = true; $("chat-card").hidden = false;
  $("welcome").textContent = "Hello, " + account.username;
  loadConversations();
}
async function loadConversations() {
  try {
    const data = await request("/conversations"); conversations = data.conversations || [];
    $("conversation-list").replaceChildren();
    for (const conversation of conversations) {
      const button = document.createElement("button"); button.className = "conversation" + (activeConversation===conversation.id?" active":"");
      const others = (conversation.members||[]).filter(member=>member.id!==account.id).map(member=>member.username).join(", ");
      button.textContent = conversation.title || others || "Conversation";
      button.addEventListener("click",()=>openConversation(conversation.id,button.textContent));
      $("conversation-list").append(button);
    }
    if (activeConversation && conversations.some(c=>c.id===activeConversation)) {
      const selected = conversations.find(c=>c.id===activeConversation);
      const others = (selected.members||[]).filter(m=>m.id!==account.id).map(m=>m.username).join(", ");
      await openConversation(activeConversation,selected.title || others || "Conversation");
    }
  } catch(error) { console.error(error); }
}
async function openConversation(id,title) {
  activeConversation=id; $("thread-title").textContent=title;
  document.querySelectorAll(".conversation").forEach(button=>button.classList.toggle("active",button.textContent===title));
  $("message").disabled=false; $("send-form").querySelector("button").disabled=false;
  try {
    const data=await request("/conversations/"+encodeURIComponent(id)+"/messages");
    $("messages").replaceChildren();
    for (const message of data.messages||[]) {
      const item=document.createElement("div"); item.className="message"+(message.sender_id===account.id?" mine":"");
      const sender=document.createElement("small"); sender.textContent=message.sender || "Member";
      const body=document.createElement("div"); body.textContent=message.body;
      item.append(sender,body); $("messages").append(item);
    }
    if (!data.messages?.length) $("messages").innerHTML='<p class="empty">No messages yet. Start the conversation.</p>';
    $("messages").scrollTop=$("messages").scrollHeight;
  } catch(error) { setNotice(error.message); }
}
$("new-conversation").addEventListener("submit",async event=>{
  event.preventDefault(); const member=$("member").value.trim(); if(!member)return;
  try { const data=await request("/conversations",{method:"POST",body:JSON.stringify({kind:"direct",members:[member]})}); $("member").value=""; activeConversation=data.id; await loadConversations(); }
  catch(error) { alert(error.message); }
});
$("send-form").addEventListener("submit",async event=>{
  event.preventDefault(); const body=$("message").value.trim(); if(!body||!activeConversation)return;
  const button=$("send-form").querySelector("button"); button.disabled=true;
  try { await request("/conversations/"+encodeURIComponent(activeConversation)+"/messages",{method:"POST",body:JSON.stringify({body})}); $("message").value=""; const selected=conversations.find(c=>c.id===activeConversation); const others=(selected?.members||[]).filter(m=>m.id!==account.id).map(m=>m.username).join(", "); await openConversation(activeConversation,selected?.title||others||"Conversation"); }
  catch(error) { alert(error.message); } finally { button.disabled=false; }
});
$("logout").addEventListener("click",()=>{token="";account=null;activeConversation=null;localStorage.removeItem("bitvoid.cloud.token");$("chat-card").hidden=true;$("auth-card").hidden=false;$("auth-form").reset();setMode("login");});
async function restoreSession() {
  if (!token) return;
  try { const data=await request("/auth/me"); account=data.account; showChat(); }
  catch { token="";localStorage.removeItem("bitvoid.cloud.token"); }
}
restoreSession();
