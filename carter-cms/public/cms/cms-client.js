// Public site renderer: loads the site + the published page for the current URL and renders its blocks.
import { doc, getDoc, collection, query, where, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { SITE_ID } from "./firebase-config.js";
import { renderBlocks, renderNavItems, footerText, themeVars } from "./blocks.js";

export function currentSlug() {
  const q = new URLSearchParams(location.search).get("slug");
  if (q) return q;
  const path = location.pathname.replace(/^\/+|\/+$/g, "").replace(/\.html$/, "");
  return !path || path === "index" ? "home" : path.split("/")[0];
}

function setMeta(name, content) {
  let m = document.querySelector(`meta[name="${name}"]`);
  if (!m) { m = document.createElement("meta"); m.name = name; document.head.append(m); }
  m.content = content;
}

function applySite(site, slug) {
  themeVars(site.theme).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
  const brand = document.getElementById("cms-brand");
  if (brand) brand.textContent = site.name || "";
  const nav = document.getElementById("cms-nav");
  if (nav) nav.innerHTML = renderNavItems(site, slug);
  const footer = document.getElementById("cms-footer");
  if (footer) footer.textContent = footerText(site);
}

export async function mount() {
  const main = document.getElementById("cms-main");
  const slug = currentSlug();
  try {
    const pagesQ = query(
      collection(db, "sites", SITE_ID, "pages"),
      where("slug", "==", slug),
      where("status", "==", "published"),
      limit(1)
    );
    const [siteSnap, pageSnap] = await Promise.all([getDoc(doc(db, "sites", SITE_ID)), getDocs(pagesQ)]);
    const site = siteSnap.exists() ? siteSnap.data() : {};
    applySite(site, slug);

    const page = pageSnap.docs[0]?.data();
    if (!page) {
      document.title = `Page not found | ${site.name || ""}`;
      setMeta("robots", "noindex");
      main.innerHTML = `<section class="cms-section"><div class="container cms-prose">
        <h1>Page not found</h1><p>This page moved or no longer exists.</p>
        <a class="btn btn-cms" href="/">Go to the home page</a></div></section>`;
      return;
    }
    document.title = page.seo?.title || (slug === "home" ? site.name : `${page.title} | ${site.name}`);
    setMeta("description", page.seo?.description || site.tagline || "");
    main.innerHTML = renderBlocks(page.blocks);
  } catch (err) {
    console.error("[cms] Failed to load content. Check cms/firebase-config.js and your Firestore rules.", err);
    main.innerHTML = `<section class="cms-section"><div class="container cms-prose">
      <h1>This page didn't load</h1><p>Refresh to try again.</p></div></section>`;
  }
}
