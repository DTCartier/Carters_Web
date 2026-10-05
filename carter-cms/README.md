# Carter CMS — starter

A multi-site, block-based CMS for Carter Web Services, built on the stack you already run:
Firebase (Auth, Firestore, Storage) for data, Netlify for hosting, Bootstrap 5.3 + vanilla JS for the UI.
No build step, no server to maintain.

One Firebase project holds every client site. Each client site is its own Netlify site built from this
repo with its own `CMS_SITE_ID`. Clients log in at `/admin` on their own domain and edit only their site.

**Publishing flow:** a client clicks Publish → the admin calls the site's `rebuild` function →
the function checks they're allowed to edit that site → Netlify rebuilds → every published page is
written out as static HTML. The live site updates in about a minute, and visitors and search engines
get finished pages with no database call.

```
 Browser (client's domain)                Firebase project (yours)
 ┌───────────────────────────┐            ┌─────────────────────────────┐
 │ /            index.html   │── reads ──▶│ sites/{siteId}              │  name, nav, theme
 │   └ cms/cms-client.js     │            │   pages/{pageId}            │  title, slug, blocks[]
 │ /admin/      admin app    │── writes ─▶│ siteMembers/{siteId}        │  who can edit
 │   └ admin/admin.js        │            │ Storage: sites/{id}/media/* │  uploaded images
 └───────────────────────────┘            └─────────────────────────────┘
        Netlify (static)                    Security enforced by *.rules
```

## What's in the box

```
carter-cms/
├── package.json                 Marks the project as ES modules (no dependencies)
├── build/
│   ├── prerender.mjs            Netlify build step: published pages → static HTML, sitemap, robots
│   └── firestore-rest.mjs       Tiny Firestore reader (no SDK, no service account)
├── netlify/functions/
│   └── rebuild.mjs              Verifies the editor, then triggers the build hook
├── public/                      ← Source files (the build copies these into dist/)
│   ├── index.html               Page template (cms:* markers get filled at build time)
│   ├── assets/css/site.css      Public theme (navy/teal, DM Sans + DM Serif Display)
│   ├── bootstrap-5.3.8-dist/    Bootstrap 5.3.8 (path kept exactly)
│   ├── cms/
│   │   ├── firebase-config.js   ← paste your Firebase config + set SITE_ID
│   │   ├── firebase.js          Firebase init
│   │   ├── blocks.js            Section types: editor fields + public HTML, in one place
│   │   └── cms-client.js        Public renderer
│   └── admin/
│       ├── login.html           Sign in + password reset
│       ├── index.html           Dashboard shell
│       ├── admin.css            Admin styles
│       └── admin.js             Pages, block editor, preview, settings, new site
├── firestore.rules              Who can read/write what
├── storage.rules                Image upload rules (5 MB, images only)
├── firebase.json                For `firebase deploy --only firestore,storage`
├── netlify.toml                 Build command, functions, security headers
└── scripts/                     Run locally with a service account (never deployed)
    ├── set-admin.js             Make yourself platform admin
    └── add-member.js            Give a client owner/editor access (creates login if needed)
```

## Setup, in order

1. **Firebase project.** In the Firebase console: create a project, add a Web app, then enable
   Authentication → Email/Password, Firestore, and Storage. (New Storage buckets need the Blaze plan.
   Skip Storage for now if you'd rather; pasting image URLs still works.)
2. **Config.** Paste the web app config into `public/cms/firebase-config.js`.
3. **Rules.** `npm i -g firebase-tools`, `firebase login`, `firebase use <project-id>`,
   then `firebase deploy --only firestore,storage`.
4. **Your login.** Firebase console → Authentication → Add user (your email).
5. **Platform admin.** Firebase console → Project settings → Service accounts → Generate new private key.
   Save it as `scripts/service-account.json` (gitignored), then:
   ```
   cd scripts && npm install
   node set-admin.js you@cartertechsllc.com
   ```
6. **Deploy to Netlify.** Push to a Git repo and create a Netlify site from it. Build settings
   come from `netlify.toml` (command `node build/prerender.mjs`, publish folder `dist`).
7. **First site.** Open the deploy's `/admin`, sign in, choose New site. The first build will have
   failed because the site didn't exist yet. That's expected.
8. **Turn on live publishing** for that Netlify site:
   - Site configuration → Build & deploy → Build hooks → Add build hook. Copy the URL.
   - Site configuration → Environment variables, add:

     | Variable | Value |
     |---|---|
     | `CMS_SITE_ID` | the site ID from step 7 |
     | `FIREBASE_PROJECT_ID` | your Firebase project ID |
     | `NETLIFY_BUILD_HOOK` | the hook URL (keep it private) |
     | `SITE_URL` | optional; `https://clientdomain.com` once the domain is connected |

   - Trigger a deploy. In `/admin` → Site settings, set Domain to the site's address
     (the `.netlify.app` one works until the real domain is connected).
9. **Add the client.** `node add-member.js owner@clientsite.com their-site-id owner`
   prints a password-set link for new accounts.

Each new client repeats steps 7–9 on a new Netlify site from the same repo: only the env vars differ.

## Roles

| Role | Can do |
|---|---|
| Platform admin (you) | Everything on every site; create sites |
| Owner | Edit and publish pages, delete pages, change site settings |
| Editor | Edit and publish pages |

## Data model

`sites/{siteId}` — `name, tagline, domain, footer, nav: [{label, slug}], theme: {primary, accent}`
`sites/{siteId}/pages/{pageId}` — `title, slug, status: draft|published, seo: {title, description}, blocks: [{id, type, data}], createdAt, updatedAt, updatedBy, publishedAt`
`siteMembers/{siteId}` — `siteName, memberIds: [uid], roles: {uid: owner|editor}`

## Adding a section type

Add one entry to `BLOCKS` in `public/cms/blocks.js` with a `label`, `fields`
(`text`, `textarea`, or `image`) and a `render(data)` function. The editor, preview and public
site pick it up automatically. Always pass user text through `esc()` and links through `safeUrl()`.

## Known limits

- **Rebuilds are per publish.** Several quick publishes queue several builds. Fine at small-business
  volume; a short delay-and-batch can be added later if build minutes become a concern.
- **Brand-new pages appear after the build** (about a minute). Use Preview in the editor before then.
- **No revision history.** Saving overwrites.
- **Slug renames don't redirect.** Changing a page's URL breaks old links until it's re-added in the menu.

## Moving to NameHero later

The build output in `dist/` is plain static files, so it runs on any host. What changes:
- `netlify.toml` → an `.htaccess` that maps `/about` to `about.html`, forces HTTPS, sets the headers.
- `netlify/functions/rebuild.mjs` → a PHP endpoint that does the same token check, then runs the
  build (or a cron job that rebuilds when content changes).
- Firebase, the admin, blocks and templates stay as they are.

## Roadmap for client sites

1. ~~Real HTML for search engines~~ Done: prerendered pages, sitemap, canonical and Open Graph tags.
2. **Per-client themes.** Each client gets their own CSS and optional custom section types on top of the shared core.
3. **Locked layouts.** A client role that can edit text and images but not add, remove or reorder sections.
4. **Onboarding from the admin.** New client → pick a starter template → invite by email (replaces `add-member.js`).
5. **One shared copy of the CMS core** so fixes reach every client site at once.
6. **WHMCS provisioning** once client hosting moves to NameHero.
