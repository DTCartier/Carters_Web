// POST /.netlify/functions/rebuild — called by /admin after a change that affects the live site.
// Triggers this site's Netlify build hook so the prerendered pages are regenerated.
//
// Auth without a service account: the caller's Firebase ID token is used to read
// siteMembers/{siteId}. Firestore rules allow that read only for platform admins and members
// of the site, so a successful read proves the token is valid AND the user can edit this site.
//
// Netlify env vars: CMS_SITE_ID, FIREBASE_PROJECT_ID, NETLIFY_BUILD_HOOK (keep the hook URL secret).

import { getDocument } from "../../build/firestore-rest.mjs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const reply = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

export default async req => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });

  const { CMS_SITE_ID, FIREBASE_PROJECT_ID, NETLIFY_BUILD_HOOK } = process.env;
  if (!CMS_SITE_ID || !FIREBASE_PROJECT_ID || !NETLIFY_BUILD_HOOK) {
    return reply(500, { error: "Live updates aren't set up on this Netlify site. Add CMS_SITE_ID, FIREBASE_PROJECT_ID and NETLIFY_BUILD_HOOK." });
  }

  const idToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!idToken) return reply(401, { error: "Sign in again, then retry." });

  const { siteId } = await req.json().catch(() => ({}));
  if (siteId !== CMS_SITE_ID) {
    return reply(400, { error: `This Netlify site builds "${CMS_SITE_ID}", not "${siteId}". Check the site's domain in Site settings.` });
  }

  try {
    const members = await getDocument({ projectId: FIREBASE_PROJECT_ID, path: `siteMembers/${CMS_SITE_ID}`, idToken });
    if (!members) return reply(403, { error: "This site has no member list. Recreate it from /admin." });
  } catch (err) {
    if (err.status === 401) return reply(401, { error: "Your session expired. Sign in again, then retry." });
    if (err.status === 403) return reply(403, { error: "You don't have access to this site." });
    console.error(err);
    return reply(502, { error: "Couldn't verify access right now. Try again in a minute." });
  }

  const hook = new URL(NETLIFY_BUILD_HOOK);
  hook.searchParams.set("trigger_title", "Content published from Carter CMS");
  const res = await fetch(hook, { method: "POST" });
  if (!res.ok) {
    console.error("Build hook failed", res.status, await res.text());
    return reply(502, { error: "The build hook didn't accept the request. Check NETLIFY_BUILD_HOOK." });
  }
  return reply(202, { ok: true });
};
