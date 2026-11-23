/* ============================= ASSISTANT (chat) =============================
   Round button bottom-right; opens a small chat window. Replies come from
   /api/chat (Claude), which receives a read-only snapshot of the dashboard. */
const CHAT_KEY = "cockpit_chat_v1";
const CHAT_SUGGESTIONS = ["What should I focus on next?", "Summarise my day so far", "Draft a follow-up for my most overdue lead"];
let chatHistory = [];
try{ chatHistory = JSON.parse(localStorage.getItem(CHAT_KEY) || "[]"); }catch(e){ chatHistory = []; }
let chatBusy = false;

function chatEsc(s){ return String(s).replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }
/* Small, safe markdown subset: bold, italics, inline code, links, bullet lists. */
function chatFormat(text){
  const lines = chatEsc(text).split("\n");
  let html = "", inList = false;
  for(const raw of lines){
    let l = raw.replace(/\*\*(.+?)\*\*/g,"<b>$1</b>").replace(/(^|[^*])\*([^*]+)\*/g,"$1<i>$2</i>").replace(/`([^`]+)`/g,"<code>$1</code>")
      .replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    const m = l.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
    if(m){ if(!inList){ html += "<ul>"; inList = true; } html += `<li>${m[1]}</li>`; continue; }
    if(inList){ html += "</ul>"; inList = false; }
    html += l.trim() ? `<p>${l}</p>` : "";
  }
  if(inList) html += "</ul>";
  return html;
}
function chatSave(){ try{ localStorage.setItem(CHAT_KEY, JSON.stringify(chatHistory.slice(-40))); }catch(e){} }

/* Read-only snapshot of the dashboard for the assistant. */
function chatContext(){
  const out = [];
  const now = new Date();
  out.push(`Now: ${now.toLocaleString(undefined,{ weekday:"long", day:"numeric", month:"long", year:"numeric", hour:"2-digit", minute:"2-digit" })}`);
  try{
    const active = state.clients.filter(c=>c.status==="active");
    out.push(`\nClients (${state.clients.length}, ${active.length} active):`);
    state.clients.slice(0,40).forEach(c=>out.push(`- ${c.company||"?"}${c.contact?` (${c.contact})`:""} · ${c.status||""}${c.model?` · ${c.model}`:""}${c.runRate?` · run rate ${c.runRate}`:""}${c.nextAction?` · next: ${c.nextAction}`:""}`));
    const fu = (typeof needsFollowUp==="function") ? needsFollowUp("all") : [];
    if(fu.length){ out.push(`\nClient-ads leads needing follow-up (${fu.length}):`); fu.slice(0,15).forEach(l=>out.push(`- ${l.leadName} · ${l.outcome} · ${l.date}`)); }
    const fit = [...state.fitnessLog].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,7);
    if(fit.length){ out.push(`\nFitness (latest 7 days):`); fit.forEach(f=>out.push(`- ${f.date}: ${f.weight!=null?f.weight+"kg":"—"}, ${f.calories!=null?f.calories+" kcal":"—"}${f.protein!=null?`, ${f.protein}g protein`:""}`)); }
  }catch(e){}
  try{
    const cc = JSON.parse(localStorage.getItem("command-centre:state:v1") || "null");
    if(cc){
      const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      const tasks = (cc.tasks||[]).filter(t=>t.date===today);
      out.push(`\nDaily Command Centre — today's tasks:`);
      ["morning","afternoon","evening"].forEach(sec=>{
        const list = tasks.filter(t=>t.section===sec);
        if(list.length) out.push(`${sec}: ` + list.map(t=>`${t.done?"[x]":"[ ]"} ${t.title}${t.kind==="priority"?" (priority)":""}${t.deadline?` by ${t.deadline}`:""}`).join("; "));
      });
      const meetings = (cc.meetings||[]).filter(m=>m.date===today).sort((a,b)=>a.start.localeCompare(b.start));
      if(meetings.length) out.push(`Meetings today: ` + meetings.map(m=>`${m.start} ${m.title}${m.attendee?` with ${m.attendee}`:""}${m.completed?" (done)":""}`).join("; "));
      const leads = (cc.leads||[]).filter(l=>l.status==="open").sort((a,b)=>(a.nextFollowUp||"9").localeCompare(b.nextFollowUp||"9")).slice(0,20);
      if(leads.length){ out.push(`Open leads (by next follow-up):`); leads.forEach(l=>out.push(`- ${l.name}${l.company?` (${l.company})`:""} · ${l.temperature} · ${l.stage} · next follow-up ${l.nextFollowUp ? l.nextFollowUp.replace("T"," ") : "not set"}${l.nextAction?` · ${l.nextAction}`:""}${l.phone?` · ${l.phone}`:""}${l.email?` · ${l.email}`:""}`)); }
      const eod = new Set((cc.eodDone||{})[today]||[]);
      if((cc.settings||{}).eodChecklist) out.push(`EOD checklist: ` + cc.settings.eodChecklist.map(i=>`${eod.has(i.id)?"[x]":"[ ]"} ${i.label}`).join("; "));
      const rec = (cc.recaps||{})[today];
      if(rec && rec.reviewed) out.push(`EOD report submitted today. Tomorrow's #1 priority: ${rec.tomorrowPriority||"—"}`);
      const st = cc.stats||{};
      if(st.weight) out.push(`Weight goal: target ${st.weight.target}kg.`);
      if(st.money && st.money.entries && st.money.entries.length) out.push(`Savings: ${st.money.entries[st.money.entries.length-1].amount} of ${st.money.goal} ${st.money.currency}.`);
    }
  }catch(e){}
  return out.join("\n");
}

/* ---- Anthropic API key (saved to the user's account, used only by the server) ---- */
let chatKeyState = null; /* null = unknown, "ok", "missing", "rejected" */
async function chatAuthed(path, body){
  const { data: { session } } = await sb.auth.getSession();
  if(!session) throw new Error("Sign in to the Cockpit first.");
  const res = await fetch(path, { method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${session.access_token}` }, body: JSON.stringify(body) });
  const j = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(j.error || `Request failed (status ${res.status}).`);
  return j;
}
async function chatCheckKey(){
  if(chatKeyState) return;
  try{ const r = await chatAuthed("/api/assistant-key", { action:"status" }); chatKeyState = r.connected ? "ok" : "missing"; }
  catch(e){ chatKeyState = null; }
  chatRender();
}
function chatKeyBox(){
  return `<form class="cc-key" id="ccKeyForm">
    <b>${chatKeyState==="rejected" ? "Your API key stopped working" : "Switch the assistant on"}</b>
    <span>${chatKeyState==="rejected" ? "Anthropic rejected the saved key (revoked or out of credit). Paste a new one." : "Paste your Anthropic API key once. It’s checked with Anthropic, saved to your Cockpit account and only used by the server. It also powers the AI summaries of your EOD reports."}</span>
    <input id="ccKeyInput" type="password" autocomplete="off" placeholder="sk-ant-…" aria-label="Anthropic API key" />
    <button type="submit" class="cc-key-btn">Connect</button>
    <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Get a key at console.anthropic.com → API Keys ↗</a>
    <em id="ccKeyMsg" role="status"></em>
  </form>`;
}
function chatBindKeyBox(){
  const f = document.getElementById("ccKeyForm"); if(!f) return;
  f.onsubmit = async (e)=>{
    e.preventDefault();
    const input = document.getElementById("ccKeyInput"), msg = document.getElementById("ccKeyMsg"), btn = f.querySelector("button");
    const key = (input.value||"").trim(); if(!key){ input.focus(); return; }
    btn.disabled = true; btn.textContent = "Checking…"; msg.textContent = "";
    try{
      await chatAuthed("/api/assistant-key", { action:"connect", key });
      chatKeyState = "ok";
      // Drop the "not set up" error and re-ask the last question, if any.
      const lastUser = [...chatHistory].reverse().find(m=>m.role==="user");
      chatHistory = chatHistory.filter(m=>!m.error);
      if(lastUser && chatHistory[chatHistory.length-1]===lastUser){ chatHistory.pop(); chatSave(); chatRender(); chatSend(lastUser.content); }
      else { chatSave(); chatRender(); }
      if(typeof toast==="function") toast("Assistant connected");
    }catch(err){ msg.textContent = err.message; btn.disabled = false; btn.textContent = "Connect"; }
  };
}

function chatRender(){
  const list = document.getElementById("ccChatList");
  if(!list) return;
  if(chatKeyState==="missing" || chatKeyState==="rejected"){
    list.innerHTML = chatKeyBox() + chatHistory.filter(m=>!m.error).map(m=>`<div class="cc-msg ${m.role}">${m.role==="assistant" ? chatFormat(m.content||"") : `<p>${chatEsc(m.content)}</p>`}</div>`).join("");
    chatBindKeyBox();
    return;
  }
  if(!chatHistory.length){
    list.innerHTML = `<div class="cc-chat-empty"><b>Hi! How can I help today?</b><span>I can see your dashboard: tasks, meetings, leads, clients and fitness.</span>
      <div class="cc-chat-sugs">${CHAT_SUGGESTIONS.map(s=>`<button type="button" class="cc-chat-sug">${chatEsc(s)}</button>`).join("")}</div></div>`;
    list.querySelectorAll(".cc-chat-sug").forEach(b=>b.addEventListener("click", ()=>chatSend(b.textContent)));
    return;
  }
  list.innerHTML = chatHistory.map(m=>`<div class="cc-msg ${m.role}${m.error?" error":""}">${m.role==="assistant" ? (m.content ? chatFormat(m.content) : '<span class="cc-typing"><i></i><i></i><i></i></span>') : `<p>${chatEsc(m.content)}</p>`}</div>`).join("");
  list.scrollTop = list.scrollHeight;
}

async function chatSend(text){
  text = (text||"").trim();
  if(!text || chatBusy) return;
  chatBusy = true;
  chatHistory.push({ role:"user", content:text });
  const reply = { role:"assistant", content:"" };
  chatHistory.push(reply);
  chatRender();
  const input = document.getElementById("ccChatInput"); if(input){ input.value = ""; input.style.height = ""; }
  const sendBtn = document.getElementById("ccChatSend"); if(sendBtn) sendBtn.disabled = true;
  try{
    const { data: { session } } = await sb.auth.getSession();
    if(!session) throw new Error("Sign in to the Cockpit first.");
    const res = await fetch("/api/chat", {
      method:"POST",
      headers:{ "Content-Type":"application/json", Authorization:`Bearer ${session.access_token}` },
      body: JSON.stringify({ messages: chatHistory.filter(m=>!m.error && m!==reply).map(({role,content})=>({role,content})), context: chatContext() }),
    });
    if(!res.ok){
      const j = await res.json().catch(()=>({}));
      if(j.code==="not_connected" || j.code==="key_rejected"){ chatKeyState = j.code==="key_rejected" ? "rejected" : "missing"; chatHistory = chatHistory.filter(m=>m!==reply); return; }
      throw new Error(j.error || `The assistant couldn’t answer (status ${res.status}).`);
    }
    const reader = res.body.getReader(); const dec = new TextDecoder();
    for(;;){ const { done, value } = await reader.read(); if(done) break; reply.content += dec.decode(value, { stream:true }); chatRender(); }
    if(!reply.content.trim()) throw new Error("The assistant didn’t reply. Try again.");
  }catch(e){
    reply.content = e.message || "Something went wrong."; reply.error = true;
  }finally{
    chatBusy = false; chatSave(); chatRender();
    if(sendBtn) sendBtn.disabled = false;
    const i = document.getElementById("ccChatInput"); if(i) i.focus();
  }
}

function setChatOpen(open){
  const panel = document.getElementById("ccChat"), fab = document.getElementById("ccChatFab");
  if(!panel || !fab) return;
  panel.hidden = !open;
  fab.setAttribute("aria-expanded", String(open));
  fab.innerHTML = open ? icon("x") : CHAT_ICON;
  fab.setAttribute("aria-label", open ? "Close assistant" : "Open assistant");
  if(open){ chatRender(); chatCheckKey(); setTimeout(()=>{ const i=document.getElementById("ccChatInput"); if(i) i.focus(); }, 30); }
}
const CHAT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/></svg>`;

function mountChat(){
  if(document.getElementById("ccChatFab")) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <button type="button" class="cc-chat-fab" id="ccChatFab" aria-controls="ccChat" aria-expanded="false" aria-label="Open assistant">${CHAT_ICON}</button>
    <section class="cc-chat" id="ccChat" role="dialog" aria-label="Assistant" hidden>
      <header class="cc-chat-head">
        <div class="cc-chat-title"><span class="cc-chat-dot"></span><div><b>Assistant</b><small>Knows your dashboard · read-only</small></div></div>
        <div class="cc-chat-actions">
          <button type="button" class="icon-btn" id="ccChatNew" title="New chat" aria-label="Start a new chat">${icon("plus")}</button>
          <button type="button" class="icon-btn" id="ccChatMin" title="Minimise" aria-label="Minimise assistant"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 12h12"/></svg></button>
        </div>
      </header>
      <div class="cc-chat-list" id="ccChatList" aria-live="polite"></div>
      <form class="cc-chat-form" id="ccChatForm">
        <textarea id="ccChatInput" rows="1" placeholder="Ask anything about your day…" aria-label="Message the assistant"></textarea>
        <button type="submit" class="cc-chat-send" id="ccChatSend" aria-label="Send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 6l6 6-6 6"/></svg></button>
      </form>
    </section>`;
  document.body.appendChild(wrap);
  document.getElementById("ccChatFab").addEventListener("click", ()=>setChatOpen(document.getElementById("ccChat").hidden));
  document.getElementById("ccChatMin").addEventListener("click", ()=>setChatOpen(false));
  document.getElementById("ccChatNew").addEventListener("click", ()=>{ if(chatBusy) return; chatHistory = []; chatSave(); chatRender(); });
  const input = document.getElementById("ccChatInput");
  input.addEventListener("input", ()=>{ input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; });
  input.addEventListener("keydown", e=>{ if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); chatSend(input.value); } });
  document.getElementById("ccChatForm").addEventListener("submit", e=>{ e.preventDefault(); chatSend(input.value); });
  document.addEventListener("keydown", e=>{ if(e.key==="Escape" && !document.getElementById("ccChat").hidden && !document.querySelector(".overlay")) setChatOpen(false); });
}
function unmountChat(){ const f=document.getElementById("ccChatFab"); if(f) f.parentElement.remove(); }
