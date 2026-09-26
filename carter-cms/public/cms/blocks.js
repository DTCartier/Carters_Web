// Block registry: the single source of truth for section types.
// Each entry defines the editor fields (used by /admin) and the public HTML (used by the site and the preview).
// To add a section type, add one entry here. Nothing else needs to change.

export const esc = (v = "") =>
  String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Allow only links that can't run script: http(s), mailto, tel, relative paths, anchors, bare slugs.
export function safeUrl(u = "") {
  const s = String(u).trim();
  if (!s) return "";
  if (/^(https?:|mailto:|tel:)/i.test(s) || /^[/#?]/.test(s)) return s;
  if (/^[a-z0-9-]+$/i.test(s)) return s === "home" ? "/" : "/" + s;
  return "";
}

export function navHref(item = {}) {
  const t = String(item.slug || "").trim();
  if (/^https?:\/\//i.test(t)) return t;
  return t === "home" || t === "" ? "/" : "/" + t;
}

// Menu items for the site header. Shared by the browser renderer, the admin preview and the prerender build.
export function renderNavItems(site = {}, slug = "home") {
  const here = slug === "home" ? "/" : "/" + slug;
  return (site.nav || []).map(item => {
    const href = navHref(item);
    return `<li class="nav-item"><a class="nav-link" href="${esc(href)}"${href === here ? ' aria-current="page"' : ""}>${esc(item.label)}</a></li>`;
  }).join("");
}

export const footerText = (site = {}) => site.footer || `© ${new Date().getFullYear()} ${site.name || ""}`.trim();

const HEX = /^#[0-9a-f]{6}$/i;
export function themeVars(t = {}) {
  return [["--cms-primary", t.primary], ["--cms-accent", t.accent]].filter(([, v]) => HEX.test(v || ""));
}
export const themeCss = t => themeVars(t).map(([k, v]) => `${k}:${v}`).join(";");

const paras = (t = "") =>
  String(t).split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
    .map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");

const button = (text, link) => {
  const href = safeUrl(link);
  return text && href ? `<a class="btn btn-cms" href="${esc(href)}">${esc(text)}</a>` : "";
};

export const BLOCKS = {
  hero: {
    label: "Hero",
    fields: [
      { key: "heading", label: "Headline", type: "text", placeholder: "Say what you do in one line" },
      { key: "subheading", label: "Supporting text", type: "textarea", rows: 3 },
      { key: "buttonText", label: "Button text", type: "text", placeholder: "Get a quote" },
      { key: "buttonLink", label: "Button link", type: "text", placeholder: "contact or https://…" },
      { key: "image", label: "Background image", type: "image", help: "Optional. Sits behind the text, darkened for contrast." }
    ],
    render: d => `
<section class="cms-hero">
  ${safeUrl(d.image) ? `<img class="cms-hero-bg" src="${esc(safeUrl(d.image))}" alt="">` : ""}
  <div class="container">
    ${d.heading ? `<h1>${esc(d.heading)}</h1>` : ""}
    ${paras(d.subheading)}
    ${button(d.buttonText, d.buttonLink)}
  </div>
</section>`
  },

  text: {
    label: "Text",
    fields: [
      { key: "heading", label: "Heading", type: "text" },
      { key: "body", label: "Body", type: "textarea", rows: 6, help: "Leave a blank line between paragraphs." }
    ],
    render: d => `
<section class="cms-section">
  <div class="container cms-prose">
    ${d.heading ? `<h2>${esc(d.heading)}</h2>` : ""}
    ${paras(d.body)}
  </div>
</section>`
  },

  image: {
    label: "Image",
    fields: [
      { key: "src", label: "Image", type: "image" },
      { key: "alt", label: "Description for screen readers", type: "text", placeholder: "What the image shows" },
      { key: "caption", label: "Caption", type: "text" }
    ],
    render: d => safeUrl(d.src) ? `
<section class="cms-section">
  <figure class="container cms-figure">
    <img src="${esc(safeUrl(d.src))}" alt="${esc(d.alt)}" loading="lazy">
    ${d.caption ? `<figcaption>${esc(d.caption)}</figcaption>` : ""}
  </figure>
</section>` : ""
  },

  features: {
    label: "Features",
    fields: [
      { key: "heading", label: "Heading", type: "text" },
      { key: "items", label: "Items", type: "textarea", rows: 5, placeholder: "Fast hosting | Sites load in under a second\nLocal support | Talk to a person in Ohio", help: "One per line: Title | Description" }
    ],
    render: d => {
      const items = String(d.items || "").split("\n").map(l => l.split("|").map(s => s.trim())).filter(([t]) => t);
      if (!items.length) return "";
      return `
<section class="cms-section">
  <div class="container">
    ${d.heading ? `<h2 class="mb-4">${esc(d.heading)}</h2>` : ""}
    <div class="row g-4">
      ${items.map(([t, desc]) => `<div class="col-md-6 col-lg-4"><div class="cms-feature"><h3>${esc(t)}</h3>${desc ? `<p>${esc(desc)}</p>` : ""}</div></div>`).join("")}
    </div>
  </div>
</section>`;
    }
  },

  cta: {
    label: "Call to action",
    fields: [
      { key: "heading", label: "Heading", type: "text", placeholder: "Ready to start?" },
      { key: "body", label: "Text", type: "textarea", rows: 2 },
      { key: "buttonText", label: "Button text", type: "text" },
      { key: "buttonLink", label: "Button link", type: "text", placeholder: "contact or https://…" }
    ],
    render: d => `
<section class="cms-cta">
  <div class="container cms-cta-inner">
    <div>
      ${d.heading ? `<h2>${esc(d.heading)}</h2>` : ""}
      ${paras(d.body)}
    </div>
    ${button(d.buttonText, d.buttonLink)}
  </div>
</section>`
  }
};

export function renderBlocks(blocks = []) {
  return (blocks || []).map(b => (BLOCKS[b.type] ? BLOCKS[b.type].render(b.data || {}) : "")).join("\n");
}

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export function newBlock(type) {
  const def = BLOCKS[type];
  return { id: uid(), type, data: Object.fromEntries(def.fields.map(f => [f.key, f.default ?? ""])) };
}
