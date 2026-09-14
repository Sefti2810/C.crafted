import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = window.SUPABASE_URL;
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || SUPABASE_URL.includes("YOUR-PROJECT")) {
  document.body.innerHTML =
    '<div style="padding:40px;font-family:sans-serif;max-width:520px;margin:0 auto">' +
    '<h2>Konfiguration fehlt</h2><p>Bitte <code>config.js</code> mit deiner Supabase-URL ' +
    "und dem anon-Key ausfüllen.</p></div>";
  throw new Error("config.js nicht ausgefüllt");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const PHOTO_BUCKET = "produkte-fotos";
const LAGERORTE = ["Garage", "Keller", "Haus"];

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------
let currentUser = null;
const loginView = document.getElementById("view-login");
const appShell = document.getElementById("app-shell");

async function init() {
  const { data } = await supabase.auth.getSession();
  currentUser = data.session?.user || null;
  updateShell();
  if (currentUser) router();

  supabase.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    updateShell();
    if (currentUser) router();
  });
}

function updateShell() {
  if (currentUser) {
    loginView.classList.add("hidden");
    appShell.classList.remove("hidden");
  } else {
    loginView.classList.remove("hidden");
    appShell.classList.add("hidden");
  }
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errBox = document.getElementById("login-error");
  errBox.textContent = "";
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) errBox.textContent = "⚠️ " + error.message;
});

// ---------------------------------------------------------------------
// Darstellung: Hell/Dunkel-Modus
// ---------------------------------------------------------------------
const THEME_KEY = "produkt-theme";
function currentEffectiveTheme() {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function updateThemeButton() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  btn.textContent = currentEffectiveTheme() === "dark" ? "☀️" : "🌙";
}
document.getElementById("theme-toggle").addEventListener("click", () => {
  const next = currentEffectiveTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
  updateThemeButton();
});
updateThemeButton();

// ---------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------
window.addEventListener("hashchange", router);

function updateNavActive() {
  const hash = location.hash || "#/";
  document.querySelectorAll(".bottom-nav-item").forEach((a) => {
    const href = a.getAttribute("href");
    const isActive = href === "#/" ? hash === "#/" || hash === "" || hash.startsWith("#/produkt/") : hash === href;
    a.classList.toggle("nav-active", isActive);
  });
}

function router() {
  const hash = location.hash || "#/";
  updateNavActive();
  if (hash === "#/" || hash === "") renderIndex();
  else if (hash === "#/add") renderAdd();
  else if (hash === "#/lager") renderLager();
  else if (hash === "#/preise") renderPreise();
  else if (hash === "#/dashboard") renderDashboard();
  else if (hash.startsWith("#/produkt/")) renderProdukt(hash.split("/")[2]);
  else renderIndex();
}

let flashHideTimer = null;
let flashRemoveTimer = null;
function flash(msg) {
  const box = document.getElementById("flash");
  clearTimeout(flashHideTimer);
  clearTimeout(flashRemoveTimer);
  box.textContent = msg;
  box.classList.remove("hidden");
  void box.offsetWidth;
  box.classList.add("show");
  flashHideTimer = setTimeout(() => box.classList.remove("show"), 2600);
  flashRemoveTimer = setTimeout(() => box.classList.add("hidden"), 3000);
}

const main = document.getElementById("main");
function mount(tplId) {
  const tpl = document.getElementById(tplId);
  main.innerHTML = "";
  main.appendChild(tpl.content.cloneNode(true));
}

// ---------------------------------------------------------------------
// Daten laden & Bestand berechnen
// ---------------------------------------------------------------------
async function loadAll() {
  const [{ data: produkte, error: e1 }, { data: buchungen, error: e2 }, { data: verkaeufe, error: e3 }] =
    await Promise.all([
      supabase.from("produkte").select("*").order("name", { ascending: true }),
      supabase.from("bestandsbuchungen").select("*"),
      supabase.from("verkaeufe").select("*"),
    ]);
  if (e1 || e2 || e3) {
    flash("⚠️ Fehler beim Laden: " + (e1 || e2 || e3).message);
    return { produkte: [], buchungen: [], verkaeufe: [] };
  }
  return { produkte: produkte || [], buchungen: buchungen || [], verkaeufe: verkaeufe || [] };
}

function bestandFuer(produktId, buchungen, verkaeufe) {
  const zu = buchungen.filter((b) => b.produkt_id === produktId).reduce((s, b) => s + b.menge, 0);
  const ab = verkaeufe.filter((v) => v.produkt_id === produktId).reduce((s, v) => s + v.menge, 0);
  return zu - ab;
}
function verkauftGesamt(produktId, verkaeufe) {
  return verkaeufe.filter((v) => v.produkt_id === produktId).reduce((s, v) => s + v.menge, 0);
}

function varianteLabel(p) {
  return [p.variante_groesse, p.variante_duft, p.variante_farbe].filter(Boolean).join(" · ");
}
function lagerortLabel(p) {
  return [p.lagerort_bereich, p.lagerort_detail].filter(Boolean).join(" – ");
}
function euro(n) {
  return (Number(n) || 0).toLocaleString("de-AT", { style: "currency", currency: "EUR" });
}

// ---------------------------------------------------------------------
// Übersicht
// ---------------------------------------------------------------------
async function renderIndex() {
  mount("tpl-index");
  const { produkte, buchungen, verkaeufe } = await loadAll();
  const items = produkte.map((p) => ({
    ...p,
    bestand: bestandFuer(p.id, buchungen, verkaeufe),
    verkauft: verkauftGesamt(p.id, verkaeufe),
  }));

  const form = document.getElementById("filter-form");
  function apply() {
    const q = (document.getElementById("q-input").value || "").toLowerCase().trim();
    const sort = form.sort.value;
    let filtered = items.filter((it) => {
      if (!q) return true;
      return [it.name, it.variante_groesse, it.variante_duft, it.variante_farbe]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q));
    });
    filtered.sort((a, b) => {
      if (sort === "name_asc") return a.name.localeCompare(b.name);
      if (sort === "name_desc") return b.name.localeCompare(a.name);
      if (sort === "bestand_asc") return a.bestand - b.bestand;
      if (sort === "bestand_desc") return b.bestand - a.bestand;
      if (sort === "verkauft_desc") return b.verkauft - a.verkauft;
      return 0;
    });
    renderGrid(filtered);
    document.getElementById("item-count").textContent = `${filtered.length} Produkt${filtered.length === 1 ? "" : "e"}`;
  }
  form.addEventListener("input", apply);
  form.addEventListener("change", apply);
  apply();
}

function renderGrid(items) {
  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty-state");
  grid.innerHTML = "";
  if (items.length === 0) {
    empty.classList.remove("hidden");
    empty.innerHTML = `<p>Noch keine Produkte gefunden.</p><a href="#/add" class="btn-primary">+ Produkt anlegen</a>`;
    return;
  }
  empty.classList.add("hidden");
  items.forEach((it) => {
    const card = document.createElement("a");
    card.href = `#/produkt/${it.id}`;
    card.className = "item-card";
    const low = it.bestand <= 0;
    card.innerHTML = `
      <div class="item-photo">${it.foto_url ? `<img src="${it.foto_url}" alt="">` : `<span class="photo-placeholder">📦</span>`}</div>
      <div class="item-card-body">
        <div class="item-card-title">${escapeHtml(it.name)}</div>
        <div class="item-card-sub">${escapeHtml(varianteLabel(it)) || "&nbsp;"}</div>
        <div class="item-card-sub">${escapeHtml(lagerortLabel(it)) || "kein Lagerort"}</div>
        <div class="item-card-footer">
          <span class="bestand-badge ${low ? "bestand-low" : ""}">Bestand: ${it.bestand}</span>
          <span>${euro(it.verkaufspreis)}</span>
        </div>
      </div>`;
    grid.appendChild(card);
  });
}

function escapeHtml(s) {
  if (!s) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------------------------------------------------------------
// Produkt hinzufügen
// ---------------------------------------------------------------------
function renderAdd() {
  mount("tpl-add");
  const form = document.getElementById("add-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.getElementById("save-status");
    status.textContent = "Speichere…";
    const fd = new FormData(form);
    const payload = {
      name: fd.get("name").trim(),
      variante_groesse: fd.get("variante_groesse")?.trim() || null,
      variante_duft: fd.get("variante_duft")?.trim() || null,
      variante_farbe: fd.get("variante_farbe")?.trim() || null,
      kosten_pro_stueck: Number(fd.get("kosten_pro_stueck")) || 0,
      verkaufspreis: Number(fd.get("verkaufspreis")) || 0,
      lagerort_bereich: fd.get("lagerort_bereich") || null,
      lagerort_detail: fd.get("lagerort_detail")?.trim() || null,
    };
    const { data: inserted, error } = await supabase.from("produkte").insert(payload).select().single();
    if (error) {
      status.textContent = "⚠️ " + error.message;
      return;
    }
    // Anfangspreis in Preishistorie loggen
    if (payload.verkaufspreis > 0) {
      await supabase.from("preishistorie").insert({ produkt_id: inserted.id, preis: payload.verkaufspreis });
    }
    const fotoFile = document.getElementById("f-foto").files[0];
    if (fotoFile) {
      const url = await uploadFoto(inserted.id, fotoFile);
      if (url) await supabase.from("produkte").update({ foto_url: url }).eq("id", inserted.id);
    }
    flash("Produkt angelegt.");
    location.hash = "#/";
  });
}

async function uploadFoto(produktId, file) {
  const ext = file.name.split(".").pop();
  const path = `${produktId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { upsert: true });
  if (error) {
    flash("⚠️ Foto-Upload fehlgeschlagen: " + error.message);
    return null;
  }
  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// ---------------------------------------------------------------------
// Produkt-Detail
// ---------------------------------------------------------------------
async function renderProdukt(id) {
  mount("tpl-produkt");
  const [{ data: produkt, error }, { data: buchungen }, { data: verkaeufe }, { data: historie }] = await Promise.all([
    supabase.from("produkte").select("*").eq("id", id).single(),
    supabase.from("bestandsbuchungen").select("*").eq("produkt_id", id).order("datum", { ascending: false }),
    supabase.from("verkaeufe").select("*").eq("produkt_id", id).order("datum", { ascending: false }),
    supabase.from("preishistorie").select("*").eq("produkt_id", id).order("gueltig_ab", { ascending: false }),
  ]);
  if (error || !produkt) {
    flash("⚠️ Produkt nicht gefunden.");
    location.hash = "#/";
    return;
  }

  // Fotos
  const photosBox = document.getElementById("item-photos");
  photosBox.innerHTML = produkt.foto_url
    ? `<div class="photo-wrap"><img src="${produkt.foto_url}" alt=""></div>`
    : `<span class="photo-placeholder">📦 Kein Foto</span>`;
  document.getElementById("change-photo-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = await uploadFoto(produkt.id, file);
    if (url) {
      await supabase.from("produkte").update({ foto_url: url }).eq("id", produkt.id);
      flash("Foto aktualisiert.");
      renderProdukt(id);
    }
  });

  // Bestand
  const bestand = bestandFuer(produkt.id, buchungen || [], verkaeufe || []);
  document.getElementById("bestand-wert").textContent = bestand;

  document.getElementById("buchen-btn").addEventListener("click", async () => {
    const menge = Number(document.getElementById("buchen-menge").value);
    const status = document.getElementById("buchen-status");
    if (!menge || menge <= 0) {
      status.textContent = "⚠️ Bitte eine gültige Menge eingeben.";
      return;
    }
    const { error } = await supabase.from("bestandsbuchungen").insert({ produkt_id: produkt.id, menge });
    if (error) { status.textContent = "⚠️ " + error.message; return; }
    flash(`${menge} Stück zugebucht.`);
    renderProdukt(id);
  });

  // Verkauf
  document.getElementById("verkauf-datum").value = new Date().toISOString().slice(0, 10);
  document.getElementById("verkauf-btn").addEventListener("click", async () => {
    const menge = Number(document.getElementById("verkauf-menge").value);
    const datum = document.getElementById("verkauf-datum").value;
    const status = document.getElementById("verkauf-status");
    if (!menge || menge <= 0) {
      status.textContent = "⚠️ Bitte eine gültige Menge eingeben.";
      return;
    }
    const { error } = await supabase.from("verkaeufe").insert({ produkt_id: produkt.id, menge, datum });
    if (error) { status.textContent = "⚠️ " + error.message; return; }
    flash(`${menge} Stück als verkauft eingetragen.`);
    renderProdukt(id);
  });

  // Edit-Formular vorbefüllen
  document.getElementById("e-name").value = produkt.name || "";
  document.getElementById("e-groesse").value = produkt.variante_groesse || "";
  document.getElementById("e-duft").value = produkt.variante_duft || "";
  document.getElementById("e-farbe").value = produkt.variante_farbe || "";
  document.getElementById("e-kosten").value = produkt.kosten_pro_stueck || "";
  document.getElementById("e-preis").value = produkt.verkaufspreis || "";
  document.getElementById("e-lagerort-bereich").value = produkt.lagerort_bereich || "";
  document.getElementById("e-lagerort-detail").value = produkt.lagerort_detail || "";

  document.getElementById("edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.getElementById("save-status");
    const neuerPreis = Number(document.getElementById("e-preis").value) || 0;
    const payload = {
      name: document.getElementById("e-name").value.trim(),
      variante_groesse: document.getElementById("e-groesse").value.trim() || null,
      variante_duft: document.getElementById("e-duft").value.trim() || null,
      variante_farbe: document.getElementById("e-farbe").value.trim() || null,
      kosten_pro_stueck: Number(document.getElementById("e-kosten").value) || 0,
      verkaufspreis: neuerPreis,
      lagerort_bereich: document.getElementById("e-lagerort-bereich").value || null,
      lagerort_detail: document.getElementById("e-lagerort-detail").value.trim() || null,
    };
    const { error } = await supabase.from("produkte").update(payload).eq("id", produkt.id);
    if (error) { status.textContent = "⚠️ " + error.message; return; }
    // Preisänderung in Historie loggen, wenn sich der Preis geändert hat
    if (neuerPreis !== Number(produkt.verkaufspreis || 0)) {
      await supabase.from("preishistorie").insert({ produkt_id: produkt.id, preis: neuerPreis });
    }
    flash("Änderungen gespeichert.");
    renderProdukt(id);
  });

  document.getElementById("delete-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!confirm(`"${produkt.name}" wirklich löschen? Das entfernt auch alle Buchungen und Verkäufe dazu.`)) return;
    const { error } = await supabase.from("produkte").delete().eq("id", produkt.id);
    if (error) { flash("⚠️ " + error.message); return; }
    flash("Produkt gelöscht.");
    location.hash = "#/";
  });

  // Verlauf
  const verlaufBody = document.getElementById("verlauf-body");
  const rows = [];
  (buchungen || []).forEach((b) => rows.push({ datum: b.datum, typ: "Produktion", text: `+${b.menge} Stück` }));
  (verkaeufe || []).forEach((v) => rows.push({ datum: v.datum, typ: "Verkauf", text: `-${v.menge} Stück` }));
  (historie || []).forEach((h) => rows.push({ datum: h.gueltig_ab, typ: "Preis", text: euro(h.preis) }));
  rows.sort((a, b) => (a.datum < b.datum ? 1 : -1));
  verlaufBody.innerHTML = rows.length
    ? `<table class="import-table"><tbody>${rows
        .map((r) => `<tr><td>${r.datum}</td><td>${r.typ}</td><td>${r.text}</td></tr>`)
        .join("")}</tbody></table>`
    : `<p class="muted">Noch kein Verlauf.</p>`;
}

// ---------------------------------------------------------------------
// Lageransicht
// ---------------------------------------------------------------------
async function renderLager() {
  mount("tpl-lager");
  const { produkte, buchungen, verkaeufe } = await loadAll();
  const groups = {};
  produkte.forEach((p) => {
    const key = p.lagerort_bereich || "Ohne Lagerort";
    if (!groups[key]) groups[key] = [];
    groups[key].push({ ...p, bestand: bestandFuer(p.id, buchungen, verkaeufe) });
  });
  const container = document.getElementById("storage-view");
  const order = [...LAGERORTE, "Ohne Lagerort"];
  container.innerHTML = order
    .filter((k) => groups[k]?.length)
    .map((k) => {
      const items = groups[k];
      return `<div class="storage-group">
        <h2>${k} <span class="muted">(${items.length})</span></h2>
        <div class="grid">
          ${items
            .map(
              (it) => `<a href="#/produkt/${it.id}" class="item-card">
                <div class="item-photo">${it.foto_url ? `<img src="${it.foto_url}" alt="">` : `<span class="photo-placeholder">📦</span>`}</div>
                <div class="item-card-body">
                  <div class="item-card-title">${escapeHtml(it.name)}</div>
                  <div class="item-card-sub">${escapeHtml(it.lagerort_detail || "")}</div>
                  <div class="item-card-footer"><span class="bestand-badge ${it.bestand <= 0 ? "bestand-low" : ""}">Bestand: ${it.bestand}</span></div>
                </div>
              </a>`
            )
            .join("")}
        </div>
      </div>`;
    })
    .join("");
  if (!container.innerHTML) container.innerHTML = `<p class="muted">Noch keine Produkte vorhanden.</p>`;
}

// ---------------------------------------------------------------------
// Preisliste
// ---------------------------------------------------------------------
async function renderPreise() {
  mount("tpl-preise");
  const { data: produkte } = await supabase.from("produkte").select("*").order("name");
  const tbody = document.getElementById("preise-tbody");
  tbody.innerHTML = (produkte || [])
    .map((p) => {
      const marge = Number(p.verkaufspreis || 0) - Number(p.kosten_pro_stueck || 0);
      return `<tr>
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(varianteLabel(p))}</td>
        <td>${euro(p.kosten_pro_stueck)}</td>
        <td>${euro(p.verkaufspreis)}</td>
        <td>${euro(marge)}</td>
      </tr>`;
    })
    .join("");
}

// ---------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------
async function renderDashboard() {
  mount("tpl-dashboard");
  const { produkte, buchungen, verkaeufe } = await loadAll();

  const items = produkte.map((p) => ({
    ...p,
    bestand: bestandFuer(p.id, buchungen, verkaeufe),
    verkauft: verkauftGesamt(p.id, verkaeufe),
  }));
  const gesamtBestand = items.reduce((s, it) => s + it.bestand, 0);
  const lagerWert = items.reduce((s, it) => s + it.bestand * Number(it.kosten_pro_stueck || 0), 0);
  const gesamtGewinnAllzeit = verkaeufe.reduce((s, v) => {
    const p = produkte.find((pr) => pr.id === v.produkt_id);
    if (!p) return s;
    return s + v.menge * (Number(p.verkaufspreis || 0) - Number(p.kosten_pro_stueck || 0));
  }, 0);

  document.getElementById("stats").innerHTML = `
    <div class="stat-card"><span class="stat-label">Produkte</span><span class="stat-value">${items.length}</span></div>
    <div class="stat-card"><span class="stat-label">Gesamtbestand</span><span class="stat-value">${gesamtBestand}</span></div>
    <div class="stat-card"><span class="stat-label">Lagerwert (zu Kosten)</span><span class="stat-value">${euro(lagerWert)}</span></div>
    <div class="stat-card"><span class="stat-label">Gewinn gesamt</span><span class="stat-value">${euro(gesamtGewinnAllzeit)}</span></div>
  `;

  // Bestseller
  const bestseller = [...items].sort((a, b) => b.verkauft - a.verkauft).slice(0, 5);
  document.getElementById("bestseller-list").innerHTML = bestseller.length
    ? `<table class="import-table"><thead><tr><th>Produkt</th><th>Verkauft</th><th>Bestand</th></tr></thead><tbody>${bestseller
        .map((b) => `<tr><td>${escapeHtml(b.name)}</td><td>${b.verkauft}</td><td>${b.bestand}</td></tr>`)
        .join("")}</tbody></table>`
    : `<p class="muted">Noch keine Verkäufe erfasst.</p>`;

  // Jahresbilanz
  const jahre = new Set(verkaeufe.map((v) => v.datum.slice(0, 4)));
  jahre.add(String(new Date().getFullYear()));
  const jahrSelect = document.getElementById("bilanz-jahr");
  jahrSelect.innerHTML = [...jahre]
    .sort((a, b) => b - a)
    .map((j) => `<option value="${j}">${j}</option>`)
    .join("");

  function renderBilanz() {
    const jahr = jahrSelect.value;
    const verkaeufeJahr = verkaeufe.filter((v) => v.datum.startsWith(jahr));
    let umsatz = 0;
    let kosten = 0;
    verkaeufeJahr.forEach((v) => {
      const p = produkte.find((pr) => pr.id === v.produkt_id);
      if (!p) return;
      umsatz += v.menge * Number(p.verkaufspreis || 0);
      kosten += v.menge * Number(p.kosten_pro_stueck || 0);
    });
    const gewinn = umsatz - kosten;
    document.getElementById("bilanz-result").innerHTML = `
      <div class="stats">
        <div class="stat-card"><span class="stat-label">Umsatz ${jahr}</span><span class="stat-value">${euro(umsatz)}</span></div>
        <div class="stat-card"><span class="stat-label">Kosten ${jahr}</span><span class="stat-value">${euro(kosten)}</span></div>
        <div class="stat-card"><span class="stat-label">Gewinn ${jahr}</span><span class="stat-value">${euro(gewinn)}</span></div>
      </div>`;
  }
  jahrSelect.addEventListener("change", renderBilanz);
  renderBilanz();

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await supabase.auth.signOut();
    location.hash = "#/";
  });

  document.getElementById("dash-export-btn").addEventListener("click", () => {
    const header = ["Name", "Größe", "Duft", "Farbe", "Kosten/Stück", "Verkaufspreis", "Lagerort", "Bestand", "Verkauft gesamt"];
    const rows = items.map((it) => [
      it.name, it.variante_groesse || "", it.variante_duft || "", it.variante_farbe || "",
      it.kosten_pro_stueck || 0, it.verkaufspreis || 0, lagerortLabel(it), it.bestand, it.verkauft,
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "produkte-export.csv";
    link.click();
  });
}

init();
