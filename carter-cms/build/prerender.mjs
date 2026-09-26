// Netlify build step: turns every published page into a static HTML file.
// Search engines and link previews get finished pages; visitors never wait on Firestore.
//
// Output (dist/):  index.html (home), <slug>.html per page, 404.html, sitemap.xml, robots.txt,
//                  plus everything in public/ (admin, assets, Bootstrap).
// Config: env vars override public/cms/firebase-config.js
//   CMS_SITE_ID          which site this deploy builds
//   FIREBASE_PROJECT_ID  / FIREBASE_API_KEY
//   SITE_URL             canonical URL, e.g. https://example.com (defaults to Netlify's URL)

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { firebaseConfig, SITE_ID } from "../public/cms/firebase-config.js";
import { renderBlocks, renderNavItems, footerText, themeCss, esc } from "../public/cms/blocks.js";
import { getDocument, queryEquals } from "./firestore-rest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "public");
const OUT = path.join(ROOT, "dist");
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const env = process.env;
const projectId = env.FIREBASE_PROJECT_ID || firebaseConfig.projectId;
const apiKey = env.FIREBASE_API_KEY || firebaseConfig.apiKey;
const siteId = env.CMS_SITE_ID || SITE_ID;
const siteUrl = (env.SITE_URL || env.URL || "").replace(/\/+$/, "");

const pagePath = slug => (slug === "home" ? "/" : `/${slug}`);

function firstImage(blocks = []) {
  for (const b of blocks) {
    const src = b?.data?.image || b?.data?.src;
    if (/^https:\/\//i.test(src || "")) return src;
  }
  return "";
}

function metaTags(site, page, { title, description, noindex }) {
  const tags = [];
  const theme = themeCss(site.theme);
  if (theme) tags.push(`<style>:root{${theme}}</style>`);
  if (noindex) { tags.push(`<meta name="robots" content="noindex">`); return tags.join("\n  "); }
  const url = siteUrl ? siteUrl + pagePath(page.slug) : "";
  const image = firstImage(page.blocks);
  if (url) tags.push(`<link rel="canonical" href="${esc(url)}">`);
  tags.push(
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:site_name" content="${esc(site.name || "")}">`
  );
  if (url) tags.push(`<meta property="og:url" content="${esc(url)}">`);
  if (image) tags.push(`<meta property="og:image" content="${esc(image)}">`);
  tags.push(`<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`);
  return tags.join("\n  ");
}

// Replacement functions (not strings) so "$" in content is never treated as a pattern.
function fill(template, site, page, { main, noindex = false }) {
  const title = page.seo?.title || (page.slug === "home" ? site.name : `${page.title} | ${site.name}`) || page.title;
  const description = page.seo?.description || site.tagline || "";
  const html = template
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${esc(description)}">`)
    .replace("<!--cms:meta-->", () => metaTags(site, page, { title, description, noindex }))
    .replace("<!--cms:brand-->", () => esc(site.name || ""))
    .replace("<!--cms:nav-->", () => renderNavItems(site, page.slug))
    .replace(/<!--cms:main-->[\s\S]*?<!--\/cms:main-->/, () => main)
    .replace("<!--cms:footer-->", () => esc(footerText(site)))
    .replace(/\s*<!--cms:script-->[\s\S]*?<!--\/cms:script-->/, () => "");
  return html;
}

async function main() {
  if (!projectId || projectId.startsWith("YOUR_")) {
    throw new Error("No Firebase project configured. Set FIREBASE_PROJECT_ID in Netlify or fill in public/cms/firebase-config.js.");
  }

  const template = await fs.readFile(path.join(SRC, "index.html"), "utf8");
  for (const marker of ["<!--cms:meta-->", "<!--cms:brand-->", "<!--cms:nav-->", "<!--cms:main-->", "<!--/cms:main-->", "<!--cms:footer-->", "<!--cms:script-->"]) {
    if (!template.includes(marker)) throw new Error(`public/index.html is missing the ${marker} marker.`);
  }

  const site = await getDocument({ projectId, apiKey, path: `sites/${siteId}` });
  if (!site) throw new Error(`No site "${siteId}" in Firebase project "${projectId}". Check CMS_SITE_ID.`);
  const pages = (await queryEquals({ projectId, apiKey, parent: `sites/${siteId}`, collectionId: "pages", where: ["status", "published"] }))
    .filter(p => SLUG.test(p.slug || ""));

  await fs.rm(OUT, { recursive: true, force: true });
  await fs.cp(SRC, OUT, { recursive: true });

  for (const page of pages) {
    const html = fill(template, site, page, { main: renderBlocks(page.blocks) });
    await fs.writeFile(path.join(OUT, page.slug === "home" ? "index.html" : `${page.slug}.html`), html);
  }

  const notFound = fill(template, site, { slug: "", title: "Page not found", seo: {} }, {
    noindex: true,
    main: `<section class="cms-section"><div class="container cms-prose">
      <h1>Page not found</h1><p>This page moved or no longer exists.</p>
      <a class="btn btn-cms" href="/">Go to the home page</a></div></section>`
  });
  await fs.writeFile(path.join(OUT, "404.html"), notFound);

  const robots = ["User-agent: *", "Disallow: /admin/"];
  if (siteUrl) {
    const urls = pages.map(p => `  <url><loc>${esc(siteUrl + pagePath(p.slug))}</loc>${p.updatedAt ? `<lastmod>${String(p.updatedAt).slice(0, 10)}</lastmod>` : ""}</url>`);
    await fs.writeFile(path.join(OUT, "sitemap.xml"),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`);
    robots.push(`Sitemap: ${siteUrl}/sitemap.xml`);
  }
  await fs.writeFile(path.join(OUT, "robots.txt"), robots.join("\n") + "\n");

  const hasHome = pages.some(p => p.slug === "home");
  console.log(`[cms] Built ${pages.length} page(s) for "${site.name || siteId}"${siteUrl ? ` at ${siteUrl}` : ""}.`);
  if (!hasHome) console.warn('[cms] No published page with the URL "home", so / falls back to the in-browser renderer.');
}

main().catch(err => {
  console.error(`[cms] Build failed: ${err.message}`);
  console.error("[cms] Netlify keeps the previous deploy live until a build succeeds.");
  process.exit(1);
});
