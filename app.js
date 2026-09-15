// ============================================================
// StockFoyer — logique de l'application
// ⚠️ Remplacer les deux valeurs ci-dessous par celles de ton
//    projet Supabase (Project Settings > API).
// ============================================================
const SUPABASE_URL = "https://puktisrifmoexclpzmbl.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1a3Rpc3JpZm1vZXhjbHB6bWJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMjkyMTQsImV4cCI6MjEwNDkwNTIxNH0.xrhXHKHUqEiTwtDN751SFh6z4Acrm5f0g7Yy_Puev_k";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------- État global ----------------
let currentUser = null;
let currentFoyer = null;   // { id, nom, code_invitation, role }
let categories = [];
let produits = [];         // avec stock joint : { ...produit, quantite_actuelle }
let listeActive = null;    // { id, nom }
let listeItems = [];
let historique = [];
let currentView = "stock";

// ---------------- Helpers UI ----------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
function show(el){ el.classList.remove("hidden"); }
function hide(el){ el.classList.add("hidden"); }

function toast(msg){
  const root = $("#toast-root");
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  root.appendChild(t);
  setTimeout(()=> t.remove(), 2200);
}

function openSheet(html){
  const root = $("#modal-root");
  root.innerHTML = `<div class="sheet-overlay" id="sheet-overlay">
    <div class="sheet">
      <div class="sheet-handle"></div>
      ${html}
    </div>
  </div>`;
  $("#sheet-overlay").addEventListener("click", (e)=>{
    if(e.target.id === "sheet-overlay") closeSheet();
  });
}
function closeSheet(){ $("#modal-root").innerHTML = ""; }

function genCode(len=6){
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for(let i=0;i<len;i++) out += chars[Math.floor(Math.random()*chars.length)];
  return out;
}

// ---------------- Démarrage ----------------
async function init(){
  const { data: { session } } = await sb.auth.getSession();
  if(!session){
    hide($("#loading-screen"));
    show($("#screen-auth"));
    return;
  }
  currentUser = session.user;
  await afterLogin();
}

sb.auth.onAuthStateChange((event, session)=>{
  if(event === "SIGNED_OUT"){
    currentUser = null; currentFoyer = null;
    hide($("#screen-main")); hide($("#screen-foyer"));
    show($("#screen-auth"));
  }
});

async function afterLogin(){
  currentUser = (await sb.auth.getUser()).data.user;
  const { data: membre } = await sb
    .from("foyer_membres")
    .select("role, foyers(id, nom, code_invitation)")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  hide($("#loading-screen"));

  if(!membre){
    show($("#screen-foyer"));
    return;
  }
  currentFoyer = { ...membre.foyers, role: membre.role };
  $("#foyer-title").textContent = currentFoyer.nom;
  show($("#screen-main"));
  await loadCategories();
  await loadAll();
  subscribeRealtime();
}

// ============================================================
// AUTH
// ============================================================
let authMode = "login";
$("#tab-login").addEventListener("click", ()=>{
  authMode = "login";
  $("#tab-login").classList.add("active");
  $("#tab-signup").classList.remove("active");
  $("#auth-submit").textContent = "Se connecter";
});
$("#tab-signup").addEventListener("click", ()=>{
  authMode = "signup";
  $("#tab-signup").classList.add("active");
  $("#tab-login").classList.remove("active");
  $("#auth-submit").textContent = "Créer mon compte";
});

$("#auth-submit").addEventListener("click", async ()=>{
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  const errBox = $("#auth-error");
  hide(errBox);
  if(!email || !password){
    errBox.textContent = "Merci de remplir l'email et le mot de passe.";
    show(errBox);
    return;
  }
  $("#auth-submit").textContent = "…";
  let res;
  if(authMode === "login"){
    res = await sb.auth.signInWithPassword({ email, password });
  } else {
    res = await sb.auth.signUp({ email, password });
  }
  $("#auth-submit").textContent = authMode === "login" ? "Se connecter" : "Créer mon compte";
  if(res.error){
    errBox.textContent = res.error.message;
    show(errBox);
    return;
  }
  if(authMode === "signup" && !res.data.session){
    errBox.classList.remove("error-msg");
    errBox.classList.add("info-msg");
    errBox.textContent = "Compte créé — vérifiez vos emails pour confirmer, puis connectez-vous.";
    show(errBox);
    return;
  }
  hide($("#screen-auth"));
  show($("#loading-screen"));
  await afterLogin();
});

// ============================================================
// FOYER (création / rejoindre)
// ============================================================
$("#btn-create-foyer").addEventListener("click", async ()=>{
  const nom = $("#foyer-nom").value.trim();
  const errBox = $("#foyer-error");
  hide(errBox);
  if(!nom){ errBox.textContent = "Donnez un nom à votre foyer."; show(errBox); return; }

  const { data: sessionData } = await sb.auth.getSession();
  const session = sessionData.session;

  let tokenInfo = "PAS DE SESSION / PAS DE TOKEN";
  if(session && session.access_token){
    try{
      const payload = JSON.parse(atob(session.access_token.split('.')[1]));
      const expDate = new Date(payload.exp * 1000);
      const expired = expDate.getTime() < Date.now();
      tokenInfo = `role: ${payload.role} | sub: ${payload.sub} | expire le: ${expDate.toLocaleString('fr-FR')} | ${expired ? 'EXPIRÉ ⚠️' : 'valide ✅'}`;
    }catch(e){ tokenInfo = "Erreur décodage token: " + e.message; }
  }

  const code = genCode();
  const { data: foyer, error } = await sb.from("foyers")
    .insert({ nom, code_invitation: code, cree_par: currentUser.id })
    .select().single();
  if(error){
    errBox.innerHTML = `<b>${error.message}</b><br>code: ${error.code||'-'}<br>details: ${error.details||'-'}<br>hint: ${error.hint||'-'}<br>user connecté: ${currentUser ? currentUser.id : 'AUCUN'}<br><br><b>Token:</b><br>${tokenInfo}`;
    show(errBox);
    return;
  }

  const { error: err2 } = await sb.from("foyer_membres")
    .insert({ foyer_id: foyer.id, user_id: currentUser.id, role: "admin" });
  if(err2){
    errBox.innerHTML = `<b>${err2.message}</b><br>code: ${err2.code||'-'}<br>details: ${err2.details||'-'}<br>hint: ${err2.hint||'-'}`;
    show(errBox);
    return;
  }

  await sb.from("listes_courses").insert({ foyer_id: foyer.id, nom: "Liste de courses" });

  hide($("#screen-foyer"));
  show($("#loading-screen"));
  await afterLogin();
});

$("#btn-join-foyer").addEventListener("click", async ()=>{
  const code = $("#foyer-code").value.trim().toUpperCase();
  const errBox = $("#foyer-error");
  hide(errBox);
  if(!code){ errBox.textContent = "Entrez un code d'invitation."; show(errBox); return; }

  const { data: foyer, error } = await sb.from("foyers")
    .select("id, nom").eq("code_invitation", code).maybeSingle();
  if(error || !foyer){ errBox.textContent = "Code introuvable."; show(errBox); return; }

  const { error: err2 } = await sb.from("foyer_membres")
    .insert({ foyer_id: foyer.id, user_id: currentUser.id, role: "membre" });
  if(err2){ errBox.textContent = err2.message; show(errBox); return; }

  hide($("#screen-foyer"));
  show($("#loading-screen"));
  await afterLogin();
});

$("#btn-logout-foyer").addEventListener("click", ()=> sb.auth.signOut());

// ============================================================
// CHARGEMENT DES DONNÉES
// ============================================================
async function loadCategories(){
  const { data } = await sb.from("categories").select("*").order("ordre");
  categories = data || [];
}

async function loadAll(){
  await Promise.all([loadProduits(), loadListe(), loadHistorique()]);
  render();
}

async function loadProduits(){
  const { data } = await sb
    .from("produits")
    .select("*, stock(quantite_actuelle)")
    .eq("foyer_id", currentFoyer.id)
    .order("nom");
  produits = (data || []).map(p => ({
    ...p,
    quantite_actuelle: p.stock?.quantite_actuelle ?? 0
  }));
}

async function loadListe(){
  const { data: listes } = await sb.from("listes_courses")
    .select("id, nom").eq("foyer_id", currentFoyer.id).order("cree_le").limit(1);
  listeActive = listes && listes[0] ? listes[0] : null;
  if(!listeActive){
    const { data } = await sb.from("listes_courses")
      .insert({ foyer_id: currentFoyer.id, nom: "Liste de courses" }).select().single();
    listeActive = data;
  }
  const { data: items } = await sb.from("listes_courses_items")
    .select("*, produits(nom, unite)")
    .eq("liste_id", listeActive.id)
    .order("coche");
  listeItems = items || [];
}

async function loadHistorique(){
  const { data } = await sb.from("historique_mouvements")
    .select("*, produits(nom, unite)")
    .in("produit_id", produits.map(p=>p.id).length ? produits.map(p=>p.id) : ["00000000-0000-0000-0000-000000000000"])
    .order("date", { ascending:false })
    .limit(40);
  historique = data || [];
}

let realtimeChannel = null;
function subscribeRealtime(){
  if(realtimeChannel) return;
  realtimeChannel = sb.channel("stockfoyer-changes")
    .on("postgres_changes", { event:"*", schema:"public", table:"stock" }, debounceRefresh)
    .on("postgres_changes", { event:"*", schema:"public", table:"produits" }, debounceRefresh)
    .on("postgres_changes", { event:"*", schema:"public", table:"listes_courses_items" }, debounceRefresh)
    .subscribe();
}
let refreshTimer = null;
function debounceRefresh(){
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async ()=>{ await loadAll(); }, 500);
}

// ============================================================
// RENDU
// ============================================================
function render(){
  renderStock();
  renderListe();
  renderHistorique();
}

function produitsBas(){
  return produits.filter(p => p.quantite_actuelle <= p.seuil_alerte);
}

function renderStock(){
  const bas = produitsBas();
  const bannerZone = $("#alert-banner-zone");
  bannerZone.innerHTML = bas.length ? `
    <div class="alert-banner">
      <span class="ic">⚠️</span>
      <span class="txt">${bas.length} produit${bas.length>1?'s':''} en stock bas : ${bas.slice(0,3).map(p=>p.nom).join(", ")}${bas.length>3?"…":""}</span>
    </div>` : "";

  const content = $("#stock-content");
  if(produits.length === 0){
    content.innerHTML = `<div class="empty-state"><span class="ic">📦</span>Aucun produit pour l'instant.<br>Ajoutez-en un avec le bouton "+".</div>`;
    return;
  }

  const byCat = {};
  for(const p of produits){
    const catId = p.categorie_id || "none";
    byCat[catId] = byCat[catId] || [];
    byCat[catId].push(p);
  }

  let html = "";
  for(const cat of categories){
    const list = byCat[cat.id];
    if(!list || !list.length) continue;
    html += `<div class="cat-group"><div class="cat-label">${cat.icone} ${cat.nom}</div>`;
    for(const p of list) html += prodCardHTML(p);
    html += `</div>`;
  }
  if(byCat["none"]){
    html += `<div class="cat-group"><div class="cat-label">📦 Autre</div>`;
    for(const p of byCat["none"]) html += prodCardHTML(p);
    html += `</div>`;
  }
  content.innerHTML = html;

  $$(".qty-btn").forEach(btn=>{
    btn.addEventListener("click", ()=> handleQtyClick(btn.dataset.id, btn.dataset.dir, parseFloat(btn.dataset.step||"1")));
  });
  $$(".prod-card").forEach(card=>{
    card.addEventListener("click", (e)=>{
      if(e.target.closest(".qty-btn")) return;
      openEditProduct(card.dataset.id);
    });
  });
}

function prodCardHTML(p){
  const low = p.quantite_actuelle <= p.seuil_alerte;
  const step = p.unite === "pièce" ? 1 : (p.unite === "kg" || p.unite === "L" ? 0.5 : 50);
  return `
    <div class="prod-card ${low?'low':''}" data-id="${p.id}">
      <div class="prod-info">
        <p class="prod-name">${p.nom}</p>
        <p class="prod-qty"><b>${formatQty(p.quantite_actuelle)}</b> ${p.unite}${low ? " · seuil bas" : ""}</p>
      </div>
      <div class="qty-controls">
        <button class="qty-btn minus" data-id="${p.id}" data-dir="-1" data-step="${step}">–</button>
        <button class="qty-btn plus" data-id="${p.id}" data-dir="1" data-step="${step}">+</button>
      </div>
    </div>`;
}

function formatQty(q){
  return Number.isInteger(q) ? q : q.toFixed(2).replace(/\.?0+$/,"");
}

async function handleQtyClick(produitId, dir, step){
  const p = produits.find(x=>x.id===produitId);
  if(!p) return;
  const delta = parseFloat(dir) * step;
  const nouvelleQte = Math.max(0, p.quantite_actuelle + delta);
  await appliquerMouvement(p, nouvelleQte - p.quantite_actuelle, "manuel");
}

async function appliquerMouvement(produit, delta, source){
  if(delta === 0) return;
  const nouvelleQte = Math.max(0, produit.quantite_actuelle + delta);
  const { data: stockRow } = await sb.from("stock").select("id").eq("produit_id", produit.id).maybeSingle();
  if(stockRow){
    await sb.from("stock").update({ quantite_actuelle: nouvelleQte, derniere_maj: new Date().toISOString() }).eq("produit_id", produit.id);
  } else {
    await sb.from("stock").insert({ produit_id: produit.id, quantite_actuelle: nouvelleQte });
  }
  await sb.from("historique_mouvements").insert({
    produit_id: produit.id,
    type: delta > 0 ? "ajout" : "retrait",
    quantite: Math.abs(delta),
    source,
    user_id: currentUser.id
  });
  produit.quantite_actuelle = nouvelleQte;
  render();
}

// ============================================================
// AJOUT / EDITION PRODUIT
// ============================================================
function categorieOptionsHTML(selectedId){
  return categories.map(c=>`<option value="${c.id}" ${c.id===selectedId?"selected":""}>${c.icone} ${c.nom}</option>`).join("");
}

function openAddProduct(prefill={}){
  openSheet(`
    <h2>${prefill.nom ? "Article scanné" : "Ajouter un produit"}</h2>
    <div id="add-error" class="error-msg hidden" style="margin-bottom:10px;"></div>
    <div class="field"><label>Nom</label><input id="f-nom" type="text" value="${prefill.nom||""}" placeholder="Ex : Lait demi-écrémé"></div>
    <div class="field"><label>Catégorie</label><select id="f-cat">${categorieOptionsHTML(prefill.categorie_id)}</select></div>
    <div class="row-2">
      <div class="field"><label>Unité</label>
        <select id="f-unite">
          <option value="pièce">pièce</option>
          <option value="kg">kg</option>
          <option value="g">g</option>
          <option value="L">L</option>
          <option value="mL">mL</option>
        </select>
      </div>
      <div class="field"><label>Quantité initiale</label><input id="f-qte" type="number" step="0.1" value="1"></div>
    </div>
    <div class="field"><label>Seuil d'alerte (stock bas quand ≤)</label><input id="f-seuil" type="number" step="0.1" value="1"></div>
    <input id="f-barcode" type="hidden" value="${prefill.code_barres||""}">
    <button class="btn btn-primary btn-block" id="f-submit">Ajouter au stock</button>
  `);
  $("#f-submit").addEventListener("click", async ()=>{
    const nom = $("#f-nom").value.trim();
    const errBox = $("#add-error");
    if(!nom){ errBox.textContent = "Le nom est obligatoire."; show(errBox); return; }
    const { data: prod, error } = await sb.from("produits").insert({
      foyer_id: currentFoyer.id,
      nom,
      categorie_id: $("#f-cat").value || null,
      unite: $("#f-unite").value,
      seuil_alerte: parseFloat($("#f-seuil").value) || 0,
      code_barres: $("#f-barcode").value || null
    }).select().single();
    if(error){ errBox.textContent = error.message; show(errBox); return; }
    await sb.from("stock").insert({ produit_id: prod.id, quantite_actuelle: parseFloat($("#f-qte").value) || 0 });
    closeSheet();
    toast("Produit ajouté ✅");
    await loadAll();
  });
}

function openEditProduct(id){
  const p = produits.find(x=>x.id===id);
  if(!p) return;
  openSheet(`
    <h2>${p.nom}</h2>
    <div id="edit-error" class="error-msg hidden" style="margin-bottom:10px;"></div>
    <div class="field"><label>Nom</label><input id="e-nom" type="text" value="${p.nom}"></div>
    <div class="field"><label>Catégorie</label><select id="e-cat">${categorieOptionsHTML(p.categorie_id)}</select></div>
    <div class="row-2">
      <div class="field"><label>Unité</label>
        <select id="e-unite">
          ${["pièce","kg","g","L","mL"].map(u=>`<option value="${u}" ${u===p.unite?"selected":""}>${u}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label>Seuil d'alerte</label><input id="e-seuil" type="number" step="0.1" value="${p.seuil_alerte}"></div>
    </div>
    <div class="field"><label>Quantité actuelle</label><input id="e-qte" type="number" step="0.1" value="${p.quantite_actuelle}"></div>
    <button class="btn btn-primary btn-block" id="e-submit" style="margin-bottom:10px;">Enregistrer</button>
    <button class="btn btn-danger btn-block" id="e-delete">Supprimer ce produit</button>
  `);
  $("#e-submit").addEventListener("click", async ()=>{
    const nouvelleQte = parseFloat($("#e-qte").value) || 0;
    await sb.from("produits").update({
      nom: $("#e-nom").value.trim(),
      categorie_id: $("#e-cat").value || null,
      unite: $("#e-unite").value,
      seuil_alerte: parseFloat($("#e-seuil").value) || 0
    }).eq("id", p.id);
    if(nouvelleQte !== p.quantite_actuelle){
      await appliquerMouvement(p, nouvelleQte - p.quantite_actuelle, "manuel");
    }
    closeSheet();
    toast("Modifié ✅");
    await loadAll();
  });
  $("#e-delete").addEventListener("click", async ()=>{
    await sb.from("produits").delete().eq("id", p.id);
    closeSheet();
    toast("Produit supprimé");
    await loadAll();
  });
}

// ============================================================
// SCAN CODE-BARRES + OPEN FOOD FACTS
// ============================================================
let html5QrCode = null;

function openScanner(){
  openSheet(`
    <h2>Scanner un produit</h2>
    <div id="scanner-view"></div>
    <p style="text-align:center;color:var(--ink-soft);font-size:13px;">Visez le code-barres avec la caméra.</p>
    <button class="btn btn-secondary btn-block" id="scanner-cancel">Annuler</button>
  `);
  if(!window.Html5Qrcode){
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js";
    s.onload = startScanner;
    document.head.appendChild(s);
  } else {
    startScanner();
  }
  $("#scanner-cancel").addEventListener("click", stopScannerAndClose);
}

function startScanner(){
  html5QrCode = new Html5Qrcode("scanner-view");
  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 240, height: 140 } },
    onBarcodeDetected,
    ()=>{}
  ).catch(()=> toast("Impossible d'accéder à la caméra."));
}

function stopScannerAndClose(){
  if(html5QrCode){
    html5QrCode.stop().then(()=>{ html5QrCode=null; closeSheet(); }).catch(()=>closeSheet());
  } else {
    closeSheet();
  }
}

async function onBarcodeDetected(code){
  if(html5QrCode){ try{ await html5QrCode.stop(); }catch(e){} html5QrCode = null; }

  const existant = produits.find(p => p.code_barres === code);
  if(existant){
    closeSheet();
    openQuickStock(existant);
    return;
  }

  closeSheet();
  toast("Recherche du produit…");
  let nom = "";
  try{
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json`);
    const data = await res.json();
    if(data.status === 1){
      nom = data.product.product_name_fr || data.product.product_name || "";
    }
  }catch(e){ /* pas de réseau OFF, on laisse vide */ }

  openAddProduct({ nom, code_barres: code });
}

function openQuickStock(p){
  const step = p.unite === "pièce" ? 1 : (p.unite === "kg" || p.unite === "L" ? 0.5 : 50);
  openSheet(`
    <h2>${p.nom}</h2>
    <p style="color:var(--ink-soft);margin-top:-8px;">Stock actuel : <b>${formatQty(p.quantite_actuelle)} ${p.unite}</b></p>
    <div class="row-2" style="margin:16px 0;">
      <button class="btn btn-primary btn-block" id="qs-plus">+ Ajouter ${step} ${p.unite}</button>
      <button class="btn btn-danger btn-block" id="qs-minus">– Retirer ${step} ${p.unite}</button>
    </div>
    <button class="btn btn-secondary btn-block" id="qs-close">Fermer</button>
  `);
  $("#qs-plus").addEventListener("click", async ()=>{ await appliquerMouvement(p, step, "scan"); closeSheet(); toast("Stock mis à jour ✅"); });
  $("#qs-minus").addEventListener("click", async ()=>{ await appliquerMouvement(p, -step, "scan"); closeSheet(); toast("Stock mis à jour ✅"); });
  $("#qs-close").addEventListener("click", closeSheet);
}

// ============================================================
// LISTE DE COURSES
// ============================================================
function renderListe(){
  $("#liste-count").textContent = listeItems.filter(i=>!i.coche).length;
  const content = $("#liste-content");
  if(listeItems.length === 0){
    content.innerHTML = `<div class="empty-state"><span class="ic">📝</span>Liste vide.<br>Ajoutez un article avec le bouton "+".</div>`;
    return;
  }
  const sorted = [...listeItems].sort((a,b)=> (a.coche - b.coche));
  content.innerHTML = sorted.map(item => `
    <div class="list-item ${item.coche?'checked':''}" data-id="${item.id}">
      <div class="checkbox ${item.coche?'checked':''}" data-toggle="${item.id}">${item.coche?'✓':''}</div>
      <div class="txt">${item.produits?.nom || item.nom_libre}</div>
      <div class="qty-tag">${formatQty(item.quantite_demandee)} ${item.produits?.unite||''}</div>
    </div>
  `).join("") + `
    <button class="btn btn-primary btn-block" id="btn-valider-courses" style="margin-top:14px;">Valider les courses cochées</button>
  `;
  $$("[data-toggle]").forEach(el=>{
    el.addEventListener("click", ()=> toggleItem(el.dataset.toggle));
  });
  const validBtn = $("#btn-valider-courses");
  if(validBtn) validBtn.addEventListener("click", validerCourses);
}

async function toggleItem(id){
  const item = listeItems.find(i=>i.id===id);
  await sb.from("listes_courses_items").update({ coche: !item.coche }).eq("id", id);
  item.coche = !item.coche;
  renderListe();
}

async function validerCourses(){
  const cochés = listeItems.filter(i=>i.coche);
  if(!cochés.length){ toast("Aucun article coché."); return; }
  for(const item of cochés){
    if(item.produit_id){
      const p = produits.find(x=>x.id===item.produit_id);
      if(p) await appliquerMouvement(p, item.quantite_demandee, "manuel");
    }
    await sb.from("listes_courses_items").delete().eq("id", item.id);
  }
  toast("Courses ajoutées au stock ✅");
  await loadAll();
}

function openAddListeItem(){
  const options = produits.map(p=>`<option value="${p.id}">${p.nom}</option>`).join("");
  openSheet(`
    <h2>Ajouter à la liste de courses</h2>
    <div class="field">
      <label>Produit existant (optionnel)</label>
      <select id="li-produit"><option value="">— Nouvel article libre —</option>${options}</select>
    </div>
    <div class="field"><label>Ou nom libre</label><input id="li-nom" type="text" placeholder="Ex : Farine T55"></div>
    <div class="field"><label>Quantité</label><input id="li-qte" type="number" step="0.1" value="1"></div>
    <button class="btn btn-primary btn-block" id="li-submit">Ajouter</button>
  `);
  $("#li-submit").addEventListener("click", async ()=>{
    const produitId = $("#li-produit").value || null;
    const nomLibre = $("#li-nom").value.trim();
    if(!produitId && !nomLibre){ toast("Choisissez un produit ou entrez un nom."); return; }
    await sb.from("listes_courses_items").insert({
      liste_id: listeActive.id,
      produit_id: produitId,
      nom_libre: produitId ? null : nomLibre,
      quantite_demandee: parseFloat($("#li-qte").value) || 1
    });
    closeSheet();
    toast("Ajouté à la liste ✅");
    await loadAll();
  });
}

// ============================================================
// HISTORIQUE
// ============================================================
function renderHistorique(){
  const content = $("#historique-content");
  if(historique.length === 0){
    content.innerHTML = `<div class="empty-state"><span class="ic">🕒</span>Aucun mouvement pour l'instant.</div>`;
    return;
  }
  content.innerHTML = historique.map(h => `
    <div class="list-item">
      <div style="font-size:20px;">${h.type === 'ajout' ? '➕' : '➖'}</div>
      <div class="txt">${h.produits?.nom || 'Produit supprimé'}
        <div style="font-weight:400;font-size:12px;color:var(--ink-soft);">
          ${new Date(h.date).toLocaleString('fr-FR', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})} · ${h.source}
        </div>
      </div>
      <div class="qty-tag">${h.type === 'ajout' ? '+' : '-'}${formatQty(h.quantite)} ${h.produits?.unite||''}</div>
    </div>
  `).join("");
}

// ============================================================
// NAVIGATION
// ============================================================
$$(".nav-btn").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    $$(".nav-btn").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    currentView = btn.dataset.view;
    ["stock","liste","historique"].forEach(v=>{
      const el = $("#view-"+v);
      v === currentView ? show(el) : hide(el);
    });
  });
});

$("#fab-main").addEventListener("click", ()=>{
  if(currentView === "stock"){
    openSheet(`
      <h2>Ajouter un produit</h2>
      <button class="btn btn-primary btn-block" id="opt-scan" style="margin-bottom:10px;">📷 Scanner un code-barres</button>
      <button class="btn btn-secondary btn-block" id="opt-manuel">✍️ Saisir manuellement</button>
    `);
    $("#opt-scan").addEventListener("click", openScanner);
    $("#opt-manuel").addEventListener("click", ()=> openAddProduct());
  } else if(currentView === "liste"){
    openAddListeItem();
  }
});

$("#btn-settings").addEventListener("click", ()=>{
  openSheet(`
    <h2>Paramètres du foyer</h2>
    <p style="color:var(--ink-soft);">Foyer : <b>${currentFoyer.nom}</b></p>
    <label>Code d'invitation à partager</label>
    <div class="code-display" style="margin-bottom:16px;">${currentFoyer.code_invitation}</div>
    <button class="btn btn-danger btn-block" id="btn-logout">Se déconnecter</button>
  `);
  $("#btn-logout").addEventListener("click", ()=> sb.auth.signOut());
});

// ---------------- PWA install / service worker ----------------
if("serviceWorker" in navigator){
  window.addEventListener("load", ()=> navigator.serviceWorker.register("sw.js").catch(()=>{}));
}

init();
