// Block registry: the single source of truth for section types.
// Each entry defines the editor fields (used by /admin) and the public HTML (used by the site and the preview).
// To add a section type, add one entry here and wrap its HTML in section(). Nothing else needs to change.

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

// Design settings shared by every section, stored as block.style. Values come from fixed lists and become
// classes, so clients can restyle a section without writing CSS (and can't inject any).
const CUSTOM_BG = "#F3F6F9";
export const STYLE_FIELDS = [
  { key: "bg", label: "Background", type: "select", options: [
    ["", "Default"], ["none", "White"], ["light", "Light"], ["primary", "Brand color"],
    ["accent", "Accent color"], ["dark", "Dark"], ["custom", "Custom color"], ["image", "Image"]] },
  { key: "bgColor", label: "Background color", type: "color", default: CUSTOM_BG, when: ["bg", "custom"] },
  { key: "bgImage", label: "Background image", type: "image", wide: true, when: ["bg", "image"] },
  { key: "overlay", label: "Darken image", type: "select", when: ["bg", "image"], options: [
    ["", "Medium"], ["light", "Light"], ["strong", "Strong"]] },
  { key: "text", label: "Text color", type: "select", options: [["", "Automatic"], ["dark", "Dark"], ["light", "Light"]] },
  { key: "spacing", label: "Spacing", type: "select", options: [["", "Default"], ["sm", "Compact"], ["lg", "Spacious"]] },
  { key: "align", label: "Alignment", type: "select", options: [["", "Left"], ["center", "Centered"]] },
  { key: "width", label: "Content width", type: "select", options: [["", "Standard"], ["narrow", "Narrow"], ["wide", "Full width"]] },
  { key: "anchor", label: "Section ID", type: "text", placeholder: "services", wide: true,
    help: "Optional. Lets buttons and menu links jump here with #services." }
];

const STYLE_DEF = Object.fromEntries(STYLE_FIELDS.map(f => [f.key, f]));
// The stored value if it's one of the field's options, otherwise "" (the default).
const pick = (s, key) => (STYLE_DEF[key].options.some(([v]) => v && v === s[key]) ? s[key] : "");

export const customBg = (s = {}) => (HEX.test(s.bgColor || "") ? s.bgColor : CUSTOM_BG);

// Relative luminance under ~0.22 reads better with white text than with the dark body text.
function isDark(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.22;
}

function textTone(s, bg) {
  const text = pick(s, "text");
  if (text) return text;
  if (bg === "custom") return isDark(customBg(s)) ? "light" : "dark";
  return { none: "dark", light: "dark", accent: "dark", primary: "light", dark: "light", image: "light" }[bg] || "";
}

const ANCHOR = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// One section with its design settings applied. base is the block's own class, inner its content.
export function section(base, s = {}, inner = "") {
  const bg = pick(s, "bg");
  const cls = ["cms-block", base];
  if (bg) cls.push("cms-has-bg", `cms-bg-${bg}`);
  if (bg === "image" && pick(s, "overlay")) cls.push(`cms-overlay-${pick(s, "overlay")}`);
  const tone = textTone(s, bg);
  if (tone) cls.push(`cms-text-${tone}`);
  for (const key of ["spacing", "align", "width"]) {
    if (pick(s, key)) cls.push(`cms-${{ spacing: "pad", align: "align", width: "w" }[key]}-${pick(s, key)}`);
  }
  const anchor = String(s.anchor || "").trim();
  const id = ANCHOR.test(anchor) && !anchor.startsWith("cms-") ? ` id="${anchor}"` : "";
  const css = bg === "custom" ? ` style="--sec-bg:${customBg(s)}"` : "";
  const img = bg === "image" && safeUrl(s.bgImage) ? `\n  <img class="cms-sec-bg" src="${esc(safeUrl(s.bgImage))}" alt="">` : "";
  return `
<section class="${cls.join(" ")}"${id}${css}>${img}${inner}
</section>`;
}

// Short description of a section's non-default design settings, for the editor.
export function styleSummary(s = {}) {
  const bg = pick(s, "bg");
  return STYLE_FIELDS
    .filter(f => f.options && (!f.when || f.when[1] === bg))
    .map(f => pick(s, f.key) && f.options.find(([v]) => v === s[f.key])[1])
    .filter(Boolean).join(" · ");
}

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
    // A background image chosen under Design replaces the hero's own image.
    render: (d, s = {}) => section("cms-hero", s, `
  ${s.bg !== "image" && safeUrl(d.image) ? `<img class="cms-hero-bg" src="${esc(safeUrl(d.image))}" alt="">` : ""}
  <div class="container">
    ${d.heading ? `<h1>${esc(d.heading)}</h1>` : ""}
    ${paras(d.subheading)}
    ${button(d.buttonText, d.buttonLink)}
  </div>`)
  },

  text: {
    label: "Text",
    fields: [
      { key: "heading", label: "Heading", type: "text" },
      { key: "body", label: "Body", type: "textarea", rows: 6, help: "Leave a blank line between paragraphs." }
    ],
    render: (d, s) => section("cms-section", s, `
  <div class="container cms-prose">
    ${d.heading ? `<h2>${esc(d.heading)}</h2>` : ""}
    ${paras(d.body)}
  </div>`)
  },

  image: {
    label: "Image",
    fields: [
      { key: "src", label: "Image", type: "image" },
      { key: "alt", label: "Description for screen readers", type: "text", placeholder: "What the image shows" },
      { key: "caption", label: "Caption", type: "text" }
    ],
    render: (d, s) => safeUrl(d.src) ? section("cms-section", s, `
  <figure class="container cms-figure">
    <img src="${esc(safeUrl(d.src))}" alt="${esc(d.alt)}" loading="lazy">
    ${d.caption ? `<figcaption>${esc(d.caption)}</figcaption>` : ""}
  </figure>`) : ""
  },

  features: {
    label: "Features",
    fields: [
      { key: "heading", label: "Heading", type: "text" },
      { key: "items", label: "Items", type: "textarea", rows: 5, placeholder: "Fast hosting | Sites load in under a second\nLocal support | Talk to a person in Ohio", help: "One per line: Title | Description" }
    ],
    render: (d, s) => {
      const items = String(d.items || "").split("\n").map(l => l.split("|").map(x => x.trim())).filter(([t]) => t);
      if (!items.length) return "";
      return section("cms-section", s, `
  <div class="container">
    ${d.heading ? `<h2 class="mb-4">${esc(d.heading)}</h2>` : ""}
    <div class="row g-4">
      ${items.map(([t, desc]) => `<div class="col-md-6 col-lg-4"><div class="cms-feature"><h3>${esc(t)}</h3>${desc ? `<p>${esc(desc)}</p>` : ""}</div></div>`).join("")}
    </div>
  </div>`);
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
    render: (d, s) => section("cms-cta", s, `
  <div class="container cms-cta-inner">
    <div>
      ${d.heading ? `<h2>${esc(d.heading)}</h2>` : ""}
      ${paras(d.body)}
    </div>
    ${button(d.buttonText, d.buttonLink)}
  </div>`)
  }
};

export function renderBlocks(blocks = []) {
  return (blocks || []).map(b => (BLOCKS[b.type] ? BLOCKS[b.type].render(b.data || {}, b.style || {}) : "")).join("\n");
}

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export function newBlock(type) {
  const def = BLOCKS[type];
  return { id: uid(), type, data: Object.fromEntries(def.fields.map(f => [f.key, f.default ?? ""])), style: {} };
}
