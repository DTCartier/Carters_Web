// Carter CMS admin: auth guard, site switching, pages list, block editor, site settings, team, new-site setup.
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { app, db } from "../cms/firebase.js";
import { BLOCKS, newBlock, renderBlocks, renderNavItems, footerText, esc, safeUrl, themeCss } from "../cms/blocks.js";
import { PORTAL_URL } from "../cms/firebase-config.js";

const auth = getAuth(app);
const $ = (sel, el = document) => el.querySelector(sel);
const view = $("#view");

const state = { user: null, platformAdmin: false, sites: [], siteId: null, role: null, site: null };
let leaveGuard = null;              // returns true when the current view has unsaved changes
let currentHash = location.hash;
let skipNextRoute = false;

const DEFAULT_THEME = { primary: "#12263F", accent: "#34C6B8" };
const pagesCol = () => collection(db, "sites", state.siteId, "pages");
const canOwn = () => state.platformAdmin || state.role === "owner";

export function slugify(s = "") {
  return String(s).toLowerCase().trim().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").slice(0, 80).replace(/^-+|-+$/g, "");
}

function toast(msg, kind = "ok") {
  const t = document.createElement("div");
  t.className = `admin-toast is-${kind}`;
  t.textContent = msg;
  $("#toasts").append(t);
  setTimeout(() => t.remove(), kind === "error" ? 6000 : 3500);
}

const fmtDate = ts => {
  const d = ts?.toDate?.();
  return d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
};
const statusBadge = s => (s === "published" ? `<span class="status is-live">Published</span>` : `<span class="status">Draft</span>`);
const head = (title, actions = "", back = "") =>
  `<div class="view-head"><div>${back}<h1>${esc(title)}</h1></div><div class="view-actions">${actions}</div></div>`;
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } }
};

// Asks the site's Netlify deploy to rebuild its static pages. Uses the site's domain from
// Site settings, so the platform admin can publish any client site from one admin.
async function refreshLiveSite() {
  const domain = state.site?.domain?.trim();
  const origin = domain ? `https://${domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}` : location.origin;
  try {
    const res = await fetch(`${origin}/.netlify/functions/rebuild`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await state.user.getIdToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ siteId: state.siteId })
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    return { ok: true };
  } catch (err) {
    console.warn("[cms] Live site refresh failed:", err);
    return { ok: false, reason: err.message };
  }
}

async function announce(label, affectsLive) {
  if (!affectsLive) { toast(label); return; }
  const r = await refreshLiveSite();
  if (r.ok) toast(`${label}. The live site updates in about a minute.`);
  else toast(`${label} in the CMS, but the live site didn't refresh. ${/^HTTP|fetch/i.test(r.reason) ? "Check the domain in Site settings." : r.reason}`, "error");
}

/* ---------- Auth + sites ---------- */

onAuthStateChanged(auth, async user => {
  if (!user) { location.replace("login.html"); return; }
  state.user = user;
  const token = await user.getIdTokenResult();
  state.platformAdmin = token.claims.platformAdmin === true;
  $("#user-email").textContent = user.email;
  $("#nav-new-site").hidden = !state.platformAdmin;
  try {
    await loadSites();
  } catch (err) {
    console.error(err);
    view.innerHTML = head("Can't load your sites") +
      `<div class="panel empty"><p>Check that the Firestore rules are deployed and that this account has access, then reload.</p></div>`;
    return;
  }
  route();
});

$("#sign-out").addEventListener("click", async () => {
  if (leaveGuard?.() && !confirm("You have unsaved changes. Sign out anyway?")) return;
  leaveGuard = null;
  await signOut(auth);
});

async function loadSites(preferId) {
  let list;
  if (state.platformAdmin) {
    const snap = await getDocs(collection(db, "sites"));
    list = snap.docs.map(d => ({ id: d.id, name: d.data().name || d.id, role: "owner" }));
  } else {
    const snap = await getDocs(query(collection(db, "siteMembers"), where("memberIds", "array-contains", state.user.uid)));
    list = snap.docs.map(d => ({ id: d.id, name: d.data().siteName || d.id, role: d.data().roles?.[state.user.uid] || "editor" }));
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  state.sites = list;
  const wanted = preferId || store.get("cms.siteId");
  await selectSite((list.find(s => s.id === wanted) || list[0])?.id || null);
  renderSiteSwitch();
}

async function selectSite(id) {
  state.siteId = id;
  state.role = state.sites.find(s => s.id === id)?.role || null;
  state.site = null;
  if (id) {
    const snap = await getDoc(doc(db, "sites", id));
    state.site = snap.exists() ? snap.data() : {};
    store.set("cms.siteId", id);
  }
  const domain = state.site?.domain?.trim();
  $("#view-site").href = domain ? (/^https?:\/\//.test(domain) ? domain : `https://${domain}`) : "/";
  $("#site-role").textContent = state.platformAdmin ? "Platform admin" : state.role === "owner" ? "Site owner" : state.role ? "Editor" : "";
  $("#nav-team").hidden = !(id && canOwn());
}

function renderSiteSwitch() {
  const sel = $("#site-switch");
  sel.innerHTML = state.sites.length
    ? state.sites.map(s => `<option value="${esc(s.id)}"${s.id === state.siteId ? " selected" : ""}>${esc(s.name)}</option>`).join("")
    : `<option value="">No sites yet</option>`;
  sel.disabled = state.sites.length < 2;
}

$("#site-switch").addEventListener("change", async e => {
  if (leaveGuard?.() && !confirm("You have unsaved changes. Switch sites anyway?")) { e.target.value = state.siteId; return; }
  leaveGuard = null;
  await selectSite(e.target.value);
  go("#/pages");
});

/* ---------- Routing ---------- */

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

window.addEventListener("hashchange", () => {
  if (skipNextRoute) { skipNextRoute = false; currentHash = location.hash; return; }
  if (leaveGuard?.() && !confirm("You have unsaved changes. Leave this page anyway?")) {
    skipNextRoute = true;
    location.hash = currentHash;
    return;
  }
  currentHash = location.hash;
  route();
});

window.addEventListener("beforeunload", e => {
  if (leaveGuard?.()) { e.preventDefault(); e.returnValue = ""; }
});

async function route() {
  const [, section = "pages", id] = (location.hash || "#/pages").split("/");
  document.querySelectorAll("[data-nav]").forEach(a => {
    if (a.dataset.nav === section) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  leaveGuard = null;
  view.onclick = view.oninput = view.onchange = view.onsubmit = null;

  if (section === "new-site") return state.platformAdmin ? viewNewSite() : go("#/pages");
  if (!state.siteId) return viewNoSites();
  if (section === "settings") return viewSettings();
  if (section === "team") return canOwn() ? viewTeam() : go("#/pages");
  if (section === "pages" && id) return viewEditor(id === "new" ? null : id);
  return viewPages();
}

function viewNoSites() {
  view.innerHTML = head("Welcome") + (state.platformAdmin
    ? `<div class="panel empty"><h2>Create your first site</h2><p>A site holds its own pages, navigation and colors. You can add clients as owners or editors later.</p><a class="btn btn-brand" href="#/new-site">Create a site</a></div>`
    : `<div class="panel empty"><h2>No sites yet</h2><p>Your account isn't connected to a site. Ask your site owner to send you an invite, then open the link in it.</p></div>`);
}

/* ---------- Pages list ---------- */

async function viewPages() {
  view.innerHTML = head("Pages", `<a class="btn btn-brand" href="#/pages/new">New page</a>`) +
    `<div class="panel" id="pages-panel"><p class="text-muted p-4 mb-0">Loading pages…</p></div>`;
  const panel = $("#pages-panel");
  let rows;
  try {
    const snap = await getDocs(query(pagesCol(), orderBy("updatedAt", "desc")));
    rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error(err);
    panel.innerHTML = `<p class="p-4 mb-0">Pages didn't load. Check your connection and reload.</p>`;
    return;
  }
  if (!rows.length) {
    panel.classList.add("empty");
    panel.innerHTML = `<h2>No pages yet</h2><p>Start with your home page. Give it the URL <code>home</code> and it becomes the front page of the site.</p><a class="btn btn-brand" href="#/pages/new">New page</a>`;
    return;
  }
  panel.innerHTML = `<div class="table-responsive"><table class="table admin-table align-middle mb-0">
    <thead><tr><th scope="col">Title</th><th scope="col">URL</th><th scope="col">Status</th><th scope="col">Last edited</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td><a class="page-link-title" href="#/pages/${esc(r.id)}">${esc(r.title || "Untitled")}</a></td>
      <td><code>/${esc(r.slug === "home" ? "" : r.slug)}</code></td>
      <td>${statusBadge(r.status)}</td>
      <td>${fmtDate(r.updatedAt)}</td>
      <td class="text-end"><a class="btn btn-sm btn-quiet" href="#/pages/${esc(r.id)}">Edit<span class="visually-hidden"> ${esc(r.title || "")}</span></a></td>
    </tr>`).join("")}</tbody></table></div>`;
}

/* ---------- Page editor ---------- */

function fieldHtml(b, f) {
  const id = `f-${b.id}-${f.key}`;
  const v = b.data[f.key] ?? "";
  const attrs = `id="${id}" data-block="${esc(b.id)}" data-key="${esc(f.key)}" placeholder="${esc(f.placeholder || "")}"${f.help ? ` aria-describedby="${id}-help"` : ""}`;
  let input;
  if (f.type === "textarea") {
    input = `<textarea class="form-control" rows="${f.rows || 4}" ${attrs}>${esc(v)}</textarea>`;
  } else if (f.type === "image") {
    input = `<div class="image-field">
      <input class="form-control" type="text" ${attrs} value="${esc(v)}">
      <label class="btn btn-quiet upload-btn">Upload<input type="file" accept="image/*" class="visually-hidden" data-upload="${esc(b.id)}" data-key="${esc(f.key)}"></label>
    </div>${safeUrl(v) ? `<img class="image-thumb" src="${esc(safeUrl(v))}" alt="">` : ""}`;
  } else {
    input = `<input class="form-control" type="text" ${attrs} value="${esc(v)}">`;
  }
  return `<div class="mb-3"><label class="form-label" for="${id}">${esc(f.label)}</label>${input}${f.help ? `<div class="form-text" id="${id}-help">${esc(f.help)}</div>` : ""}</div>`;
}

async function viewEditor(pageId) {
  view.innerHTML = `<p class="text-muted">Loading page…</p>`;
  let page = { title: "", slug: "", status: "draft", seo: {}, blocks: [] };
  if (pageId) {
    const snap = await getDoc(doc(pagesCol(), pageId)).catch(() => null);
    if (!snap?.exists()) {
      view.innerHTML = head("Page not found") + `<div class="panel empty"><p>This page was deleted or the link is wrong.</p><a class="btn btn-brand" href="#/pages">Back to pages</a></div>`;
      return;
    }
    page = { ...page, ...snap.data() };
  }
  const draft = {
    title: page.title || "",
    slug: page.slug || "",
    seo: { title: page.seo?.title || "", description: page.seo?.description || "" },
    blocks: pageId
      ? (page.blocks || []).map(b => ({ id: b.id || newBlock("text").id, type: b.type, data: { ...(b.data || {}) } }))
      : [newBlock("hero")]
  };
  const isLive = page.status === "published";
  let dirty = false;
  let slugTouched = Boolean(pageId);
  leaveGuard = () => dirty;

  const markDirty = () => {
    dirty = true;
    const s = $("#save-state");
    s.textContent = "Unsaved changes";
    s.classList.add("is-dirty");
  };

  view.innerHTML =
    head(pageId ? page.title || "Untitled" : "New page",
      `<span class="save-state" id="save-state">${pageId ? `Saved ${fmtDate(page.updatedAt)}` : ""}</span>
       <button type="button" class="btn btn-quiet" id="btn-preview">Preview</button>`,
      `<a class="back-link" href="#/pages">All pages</a>`) +
    `<div class="editor">
      <div class="editor-main">
        <div class="panel p-4">
          <label class="form-label" for="f-title">Page title</label>
          <input id="f-title" class="form-control form-control-lg" value="${esc(draft.title)}" required>
          <label class="form-label mt-3" for="f-slug">URL</label>
          <div class="input-group">
            <span class="input-group-text">/</span>
            <input id="f-slug" class="form-control" value="${esc(draft.slug)}" aria-describedby="slug-help" spellcheck="false">
          </div>
          <div class="form-text" id="slug-help">Lowercase letters, numbers and dashes. Use <code>home</code> for the front page.</div>
        </div>
        <div class="blocks" id="blocks"></div>
        <div class="panel add-block"><span>Add a section:</span>
          ${Object.entries(BLOCKS).map(([k, d]) => `<button type="button" class="btn btn-sm btn-quiet" data-add="${k}">${esc(d.label)}</button>`).join("")}
        </div>
      </div>
      <aside class="editor-side" aria-label="Publishing">
        <div class="panel p-4">
          <p class="mb-3">${statusBadge(page.status)}</p>
          <div class="d-grid gap-2">
            ${isLive
              ? `<button type="button" class="btn btn-brand" data-save="publish">Update</button>
                 <button type="button" class="btn btn-quiet" data-save="unpublish">Unpublish</button>`
              : `<button type="button" class="btn btn-brand" data-save="publish">Publish</button>
                 <button type="button" class="btn btn-quiet" data-save="draft">Save draft</button>`}
          </div>
        </div>
        <div class="panel p-4">
          <h2 class="h6">Search engines</h2>
          <label class="form-label" for="f-seo-title">Title in search results</label>
          <input id="f-seo-title" class="form-control mb-3" value="${esc(draft.seo.title)}" placeholder="Defaults to the page title">
          <label class="form-label" for="f-seo-desc">Description</label>
          <textarea id="f-seo-desc" class="form-control" rows="3" aria-describedby="seo-count">${esc(draft.seo.description)}</textarea>
          <div class="form-text" id="seo-count">${draft.seo.description.length} / 160 characters</div>
        </div>
        ${pageId && canOwn() ? `<div class="panel p-4"><button type="button" class="btn btn-link btn-danger-link" id="btn-delete">Delete page</button></div>` : ""}
      </aside>
    </div>`;

  function renderBlockList() {
    const wrap = $("#blocks");
    if (!draft.blocks.length) {
      wrap.innerHTML = `<div class="panel p-4 text-muted">This page has no sections yet. Add one below.</div>`;
      return;
    }
    const last = draft.blocks.length - 1;
    wrap.innerHTML = draft.blocks.map((b, i) => {
      const def = BLOCKS[b.type];
      if (!def) {
        return `<div class="panel p-3">Unknown section type “${esc(b.type)}”. <button type="button" class="btn btn-sm btn-quiet" data-remove="${i}">Remove</button></div>`;
      }
      return `<section class="panel block-card" aria-label="${esc(def.label)} section, position ${i + 1}">
        <header class="block-head">
          <span><span class="block-type">${esc(def.label)}</span><span class="block-order">${i + 1} of ${last + 1}</span></span>
          <div class="block-tools">
            <button type="button" class="btn btn-sm btn-quiet" data-move="${i}" data-dir="-1"${i === 0 ? " disabled" : ""} aria-label="Move ${esc(def.label)} section up">Up</button>
            <button type="button" class="btn btn-sm btn-quiet" data-move="${i}" data-dir="1"${i === last ? " disabled" : ""} aria-label="Move ${esc(def.label)} section down">Down</button>
            <button type="button" class="btn btn-sm btn-quiet" data-remove="${i}" aria-label="Remove ${esc(def.label)} section">Remove</button>
          </div>
        </header>
        <div class="block-body">${def.fields.map(f => fieldHtml(b, f)).join("")}</div>
      </section>`;
    }).join("");
  }
  renderBlockList();

  view.oninput = e => {
    const t = e.target;
    if (t.id === "f-title") {
      draft.title = t.value;
      if (!slugTouched) { draft.slug = slugify(t.value); $("#f-slug").value = draft.slug; }
    } else if (t.id === "f-slug") {
      slugTouched = true; draft.slug = t.value;
    } else if (t.id === "f-seo-title") {
      draft.seo.title = t.value;
    } else if (t.id === "f-seo-desc") {
      draft.seo.description = t.value;
      $("#seo-count").textContent = `${t.value.length} / 160 characters`;
    } else if (t.dataset.block && !t.dataset.upload) {
      const b = draft.blocks.find(x => x.id === t.dataset.block);
      if (b) b.data[t.dataset.key] = t.value;
    } else return;
    markDirty();
  };

  view.onchange = async e => {
    const t = e.target;
    if (t.id === "f-slug") { draft.slug = t.value = slugify(t.value); return; }
    if (t.dataset.upload && t.files?.[0]) await uploadImage(t);
  };

  view.onclick = async e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const d = btn.dataset;
    if (d.add) {
      draft.blocks.push(newBlock(d.add));
      markDirty(); renderBlockList();
      $(`#blocks .block-card:last-child .block-body :is(input, textarea)`)?.focus();
    } else if (d.move !== undefined) {
      const i = Number(d.move), j = i + Number(d.dir);
      [draft.blocks[i], draft.blocks[j]] = [draft.blocks[j], draft.blocks[i]];
      markDirty(); renderBlockList();
      const again = $(`[data-move="${j}"][data-dir="${d.dir}"]`);
      (again && !again.disabled ? again : $(`[data-move="${j}"][data-dir="${-Number(d.dir)}"]`))?.focus();
    } else if (d.remove !== undefined) {
      const i = Number(d.remove);
      const label = BLOCKS[draft.blocks[i]?.type]?.label || "this";
      if (!confirm(`Remove the ${label} section?`)) return;
      draft.blocks.splice(i, 1);
      markDirty(); renderBlockList();
    } else if (d.save) {
      await save(d.save, btn);
    } else if (btn.id === "btn-preview") {
      openPreview(draft.blocks);
    } else if (btn.id === "btn-delete") {
      if (!confirm(`Delete “${page.title || "this page"}”? This can't be undone.`)) return;
      try {
        await deleteDoc(doc(pagesCol(), pageId));
        dirty = false;
        await announce("Page deleted", isLive);
        go("#/pages");
      } catch (err) { console.error(err); toast("Couldn't delete the page. Only site owners can delete pages.", "error"); }
    }
  };

  async function uploadImage(input) {
    const file = input.files[0];
    if (!file.type.startsWith("image/")) return toast("Choose an image file: JPG, PNG, WebP or GIF.", "error");
    if (file.size > 5 * 1024 * 1024) return toast("Images must be under 5 MB. Resize it and try again.", "error");
    const b = draft.blocks.find(x => x.id === input.dataset.upload);
    toast("Uploading image…");
    try {
      const path = `sites/${state.siteId}/media/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "-")}`;
      const r = storageRef(getStorage(app), path);
      await uploadBytes(r, file, { contentType: file.type });
      b.data[input.dataset.key] = await getDownloadURL(r);
      markDirty(); renderBlockList(); toast("Image uploaded");
    } catch (err) {
      console.error(err);
      toast("Upload failed. Check that Firebase Storage is enabled and its rules are deployed.", "error");
    }
  }

  async function save(mode, btn) {
    const title = draft.title.trim();
    const slug = slugify(draft.slug || title);
    if (!title) { toast("Add a page title before saving.", "error"); $("#f-title").focus(); return; }
    if (!slug) { toast("Add a URL for this page.", "error"); $("#f-slug").focus(); return; }
    btn.disabled = true;
    try {
      const clash = await getDocs(query(pagesCol(), where("slug", "==", slug), limit(2)));
      if (clash.docs.some(d => d.id !== pageId)) {
        toast(`Another page already uses /${slug}. Choose a different URL.`, "error");
        $("#f-slug").focus();
        return;
      }
      const status = mode === "publish" ? "published" : "draft";
      const payload = {
        title, slug, status,
        seo: { title: draft.seo.title.trim(), description: draft.seo.description.trim() },
        blocks: draft.blocks.map(({ id, type, data }) => ({ id, type, data })),
        updatedAt: serverTimestamp(),
        updatedBy: state.user.uid
      };
      if (status === "published" && !isLive) payload.publishedAt = serverTimestamp();

      let id = pageId;
      if (id) await setDoc(doc(pagesCol(), id), payload, { merge: true });
      else { payload.createdAt = serverTimestamp(); id = (await addDoc(pagesCol(), payload)).id; }

      dirty = false;
      await announce({ publish: isLive ? "Updated" : "Published", draft: "Draft saved", unpublish: "Unpublished" }[mode],
        status === "published" || isLive);
      if (id !== pageId) go(`#/pages/${id}`); else viewEditor(id);
    } catch (err) {
      console.error(err);
      toast("Couldn't save. Check your connection and that you have access to this site.", "error");
    } finally {
      btn.disabled = false;
    }
  }
}

/* ---------- Preview ---------- */

function openPreview(blocks) {
  const s = state.site || {};
  const origin = location.origin;
  $("#preview-frame").srcdoc = `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&family=DM+Serif+Display&display=swap">
    <link rel="stylesheet" href="${origin}/bootstrap-5.3.8-dist/css/bootstrap.min.css">
    <link rel="stylesheet" href="${origin}/assets/css/site.css">
    <style>:root{${themeCss(s.theme)}} a{pointer-events:none}</style></head>
    <body><header class="cms-header"><nav class="navbar navbar-expand navbar-dark"><div class="container">
      <span class="navbar-brand">${esc(s.name || "")}</span>
      <ul class="navbar-nav ms-auto">${renderNavItems(s, "")}</ul>
    </div></nav></header>
    <main>${renderBlocks(blocks)}</main>
    <footer class="cms-footer"><div class="container">${esc(footerText(s))}</div></footer>
    </body></html>`;
  bootstrap.Modal.getOrCreateInstance($("#preview-modal")).show();
}

document.querySelectorAll("#preview-modal [data-width]").forEach(btn => {
  btn.addEventListener("click", () => {
    $("#preview-frame").style.width = btn.dataset.width;
    document.querySelectorAll("#preview-modal [data-width]").forEach(b => {
      b.classList.toggle("active", b === btn);
      b.setAttribute("aria-pressed", String(b === btn));
    });
  });
});

/* ---------- Site settings ---------- */

function viewSettings() {
  const s = state.site || {};
  const owner = canOwn();
  const theme = { ...DEFAULT_THEME, ...(s.theme || {}) };
  const navText = (s.nav || []).map(n => `${n.label} | ${n.slug}`).join("\n");

  view.innerHTML = head("Site settings") + `
    <form class="panel p-4" id="settings-form" novalidate style="max-width: 720px">
      ${owner ? "" : `<p class="notice">Only site owners can change these settings.</p>`}
      <fieldset${owner ? "" : " disabled"}>
        <div class="mb-3"><label class="form-label" for="s-name">Site name</label>
          <input class="form-control" id="s-name" name="siteName" value="${esc(s.name || "")}" required></div>
        <div class="mb-3"><label class="form-label" for="s-tagline">Tagline</label>
          <input class="form-control" id="s-tagline" name="tagline" value="${esc(s.tagline || "")}" aria-describedby="s-tagline-help">
          <div class="form-text" id="s-tagline-help">Used as the search description when a page doesn't set its own.</div></div>
        <div class="mb-3"><label class="form-label" for="s-domain">Domain</label>
          <input class="form-control" id="s-domain" name="domain" value="${esc(s.domain || "")}" placeholder="example.com" spellcheck="false" aria-describedby="s-domain-help">
          <div class="form-text" id="s-domain-help">Where this site is hosted. Publishing refreshes the site at this address. The yoursite.netlify.app address works until the real domain is connected.</div></div>
        <div class="mb-3"><label class="form-label" for="s-nav">Menu</label>
          <textarea class="form-control" id="s-nav" name="nav" rows="5" aria-describedby="s-nav-help" placeholder="Home | home&#10;Services | services&#10;Contact | contact">${esc(navText)}</textarea>
          <div class="form-text" id="s-nav-help">One link per line: Label | page URL. Full https:// links work too.</div></div>
        <div class="mb-3"><label class="form-label" for="s-footer">Footer text</label>
          <input class="form-control" id="s-footer" name="footer" value="${esc(s.footer || "")}" placeholder="© ${new Date().getFullYear()} ${esc(s.name || "")}"></div>
        <div class="row g-3 mb-4">
          <div class="col-sm-6"><label class="form-label" for="s-primary">Main color</label>
            <input type="color" class="form-control form-control-color" id="s-primary" name="primary" value="${esc(theme.primary)}"></div>
          <div class="col-sm-6"><label class="form-label" for="s-accent">Accent color</label>
            <input type="color" class="form-control form-control-color" id="s-accent" name="accent" value="${esc(theme.accent)}"></div>
        </div>
        <button class="btn btn-brand" type="submit">Save settings</button>
      </fieldset>
    </form>`;

  view.onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const name = f.siteName.value.trim();
    if (!name) { toast("Add a site name.", "error"); f.siteName.focus(); return; }
    const nav = f.nav.value.split("\n").map(line => {
      const [label, target] = line.split("|").map(x => (x || "").trim());
      if (!label) return null;
      const slug = /^https?:\/\//i.test(target) ? target : slugify(target || label) || "home";
      return { label, slug };
    }).filter(Boolean);
    const data = {
      name, nav,
      tagline: f.tagline.value.trim(),
      domain: f.domain.value.trim().replace(/^https?:\/\//, "").replace(/\/+$/, ""),
      footer: f.footer.value.trim(),
      theme: { primary: f.primary.value, accent: f.accent.value },
      updatedAt: serverTimestamp()
    };
    const btn = f.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "sites", state.siteId), data);
      if (name !== s.name) batch.update(doc(db, "siteMembers", state.siteId), { siteName: name });
      await batch.commit();
      state.site = { ...s, ...data };
      const entry = state.sites.find(x => x.id === state.siteId);
      if (entry) entry.name = name;
      renderSiteSwitch();
      await selectSite(state.siteId);
      await announce("Settings saved", true);
    } catch (err) {
      console.error(err);
      toast("Couldn't save settings. Only site owners can change them.", "error");
    } finally {
      btn.disabled = false;
    }
  };
}

/* ---------- Team (owners) ---------- */

// Team changes go through the portal's functions: browsers can't write siteMembers or invites.
async function teamCall(action, data = {}) {
  const res = await fetch(`${PORTAL_URL}/.netlify/functions/team`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await state.user.getIdToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ siteId: state.siteId, action, ...data })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `The team service isn't reachable (HTTP ${res.status}).`);
  return body;
}

const inviteLink = id =>
  `${PORTAL_URL}/admin/accept.html?site=${encodeURIComponent(state.siteId)}&invite=${encodeURIComponent(id)}`;
const roleLabel = r => (r === "owner" ? "Owner" : "Editor");

async function copyText(text, input) {
  try { await navigator.clipboard.writeText(text); toast("Invite link copied"); }
  catch { input?.select(); toast("Press Ctrl+C to copy the link.", "error"); }
}

async function viewTeam() {
  view.innerHTML = head("Team") + `
    <form class="panel p-4 mb-4" id="invite-form" novalidate>
      <h2 class="h6">Invite someone</h2>
      <div class="row g-3 align-items-end">
        <div class="col-md-6"><label class="form-label" for="i-email">Email</label>
          <input class="form-control" id="i-email" name="email" type="email" required autocomplete="off" spellcheck="false"></div>
        <div class="col-sm-6 col-md-3"><label class="form-label" for="i-role">Role</label>
          <select class="form-select" id="i-role" name="role"><option value="editor">Editor</option><option value="owner">Owner</option></select></div>
        <div class="col-sm-6 col-md-3"><button class="btn btn-brand w-100" type="submit">Create invite</button></div>
      </div>
      <p class="form-text mt-2 mb-0">Editors edit and publish pages. Owners can also change site settings and manage the team. Invites expire after 7 days.</p>
      <div id="invite-result"></div>
    </form>
    <div class="panel mb-4" id="members-panel"><p class="text-muted p-4 mb-0">Loading team…</p></div>
    <div id="invites-panel"></div>`;

  let data = { members: [], invites: [] };

  const draw = () => {
    const me = state.user.uid;
    $("#members-panel").innerHTML = `<div class="table-responsive"><table class="table admin-table align-middle mb-0">
      <thead><tr><th scope="col">Member</th><th scope="col">Role</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
      <tbody>${data.members.map(m => `<tr>
        <td>${esc(m.email)}${m.uid === me ? ` <span class="team-you">You</span>` : ""}</td>
        <td><label class="visually-hidden" for="r-${esc(m.uid)}">Role for ${esc(m.email)}</label>
          <select class="form-select form-select-sm team-role" id="r-${esc(m.uid)}" data-role="${esc(m.uid)}">
            ${["editor", "owner"].map(r => `<option value="${r}"${r === m.role ? " selected" : ""}>${roleLabel(r)}</option>`).join("")}
          </select></td>
        <td class="text-end"><button type="button" class="btn btn-sm btn-quiet" data-remove="${esc(m.uid)}">Remove<span class="visually-hidden"> ${esc(m.email)}</span></button></td>
      </tr>`).join("") || `<tr><td colspan="3" class="text-muted">No members yet.</td></tr>`}</tbody></table></div>`;

    $("#invites-panel").innerHTML = data.invites.length ? `<div class="panel">
      <h2 class="h6 px-4 pt-4">Pending invites</h2>
      <div class="table-responsive"><table class="table admin-table align-middle mb-0">
      <thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Expires</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
      <tbody>${data.invites.map(i => `<tr>
        <td>${esc(i.email)}</td><td>${roleLabel(i.role)}</td>
        <td>${new Date(i.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</td>
        <td class="text-end text-nowrap">
          <button type="button" class="btn btn-sm btn-quiet" data-copy="${esc(i.id)}">Copy link</button>
          <button type="button" class="btn btn-sm btn-quiet" data-revoke="${esc(i.id)}">Revoke<span class="visually-hidden"> invite for ${esc(i.email)}</span></button>
        </td></tr>`).join("")}</tbody></table></div></div>` : "";
  };

  const load = async () => {
    try {
      data = await teamCall("list");
      draw();
    } catch (err) {
      console.error(err);
      $("#members-panel").innerHTML = `<p class="p-4 mb-0">The team didn't load. ${esc(err.message)}</p>`;
    }
  };

  // After changing your own access, reload your sites: you may no longer be an owner here.
  const afterSelfChange = async () => {
    await loadSites(state.siteId);
    if (!canOwn()) { toast("Your access changed."); go("#/pages"); return true; }
    return false;
  };

  view.onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const email = f.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast("Enter a valid email address.", "error"); f.email.focus(); return; }
    const btn = f.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      const { invite } = await teamCall("invite", { email, role: f.role.value });
      const link = inviteLink(invite.id);
      $("#invite-result").innerHTML = `<div class="invite-link mt-3">
        <p class="mb-2">Invite created. Send this link to <strong>${esc(invite.email)}</strong>. Anyone can open it, but only that email address can accept it.</p>
        <div class="input-group"><input class="form-control" id="invite-url" readonly value="${esc(link)}" aria-label="Invite link">
          <button class="btn btn-brand" type="button" data-copy-new>Copy link</button></div></div>`;
      f.email.value = "";
      await load();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      btn.disabled = false;
    }
  };

  view.onclick = async e => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.hasAttribute("data-copy-new")) return copyText($("#invite-url").value, $("#invite-url"));
    if (t.dataset.copy) return copyText(inviteLink(t.dataset.copy));
    if (t.dataset.revoke) {
      const inv = data.invites.find(i => i.id === t.dataset.revoke);
      if (!confirm(`Revoke the invite for ${inv?.email}? The link will stop working.`)) return;
      t.disabled = true;
      try {
        await teamCall("revoke", { inviteId: t.dataset.revoke });
        toast("Invite revoked");
        // Don't leave a dead link on screen to be copied.
        if ($("#invite-url")?.value.includes(`invite=${encodeURIComponent(t.dataset.revoke)}`)) $("#invite-result").innerHTML = "";
        await load();
      }
      catch (err) { toast(err.message, "error"); t.disabled = false; }
    }
    if (t.dataset.remove) {
      const uid = t.dataset.remove;
      const m = data.members.find(x => x.uid === uid);
      const self = uid === state.user.uid;
      if (!confirm(self ? "Remove yourself from this site? You'll lose access to it." : `Remove ${m?.email} from this site?`)) return;
      t.disabled = true;
      try {
        await teamCall("remove", { uid });
        toast(self ? "You left the site" : `${m?.email} removed`);
        if (self && await afterSelfChange()) return;
        await load();
      } catch (err) { toast(err.message, "error"); t.disabled = false; }
    }
  };

  view.onchange = async e => {
    const sel = e.target.closest("select[data-role]");
    if (!sel) return;
    const uid = sel.dataset.role;
    const m = data.members.find(x => x.uid === uid);
    sel.disabled = true;
    try {
      await teamCall("setRole", { uid, role: sel.value });
      toast(`${m?.email} is now ${sel.value === "owner" ? "an owner" : "an editor"}`);
      if (uid === state.user.uid && await afterSelfChange()) return;
      await load();
    } catch (err) {
      toast(err.message, "error");
      sel.value = m?.role || "editor";
      sel.disabled = false;
    }
  };

  await load();
}

/* ---------- New site (platform admin) ---------- */

function viewNewSite() {
  view.innerHTML = head("New site") + `
    <form class="panel p-4" id="new-site-form" novalidate style="max-width: 560px">
      <div class="mb-3"><label class="form-label" for="n-name">Site name</label>
        <input class="form-control" id="n-name" name="siteName" required placeholder="Dwell Carolina"></div>
      <div class="mb-4"><label class="form-label" for="n-id">Site ID</label>
        <input class="form-control" id="n-id" name="siteId" required spellcheck="false" aria-describedby="n-id-help">
        <div class="form-text" id="n-id-help">Permanent. Set <code>SITE_ID</code> in cms/firebase-config.js to this value in the deploy for this site.</div></div>
      <button class="btn btn-brand" type="submit">Create site</button>
    </form>`;

  let idTouched = false;
  view.oninput = e => {
    if (e.target.id === "n-name" && !idTouched) $("#n-id").value = slugify(e.target.value);
    if (e.target.id === "n-id") idTouched = true;
  };
  view.onsubmit = async e => {
    e.preventDefault();
    const name = e.target.siteName.value.trim();
    const siteId = slugify(e.target.siteId.value);
    if (!name || !siteId) { toast("Add a site name and ID.", "error"); return; }
    const btn = e.target.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      if ((await getDoc(doc(db, "sites", siteId))).exists()) {
        toast(`A site with the ID “${siteId}” already exists. Choose another.`, "error");
        return;
      }
      const uid = state.user.uid;
      const batch = writeBatch(db);
      batch.set(doc(db, "sites", siteId), {
        name, tagline: "", domain: "", footer: "",
        nav: [{ label: "Home", slug: "home" }],
        theme: { ...DEFAULT_THEME },
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      batch.set(doc(db, "siteMembers", siteId), { siteName: name, memberIds: [uid], roles: { [uid]: "owner" } });
      const home = newBlock("hero");
      home.data.heading = name;
      batch.set(doc(collection(db, "sites", siteId, "pages")), {
        title: "Home", slug: "home", status: "draft", seo: { title: "", description: "" },
        blocks: [home], createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: uid
      });
      await batch.commit();
      toast("Site created");
      await loadSites(siteId);
      go("#/pages");
    } catch (err) {
      console.error(err);
      toast("Couldn't create the site. Only platform admins can create sites.", "error");
    } finally {
      btn.disabled = false;
    }
  };
}
