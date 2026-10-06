// Shared setup for functions that need full Firestore/Auth access (invites, team changes).
// They run on the portal site only, because they hold the service-account key.
//
// Netlify env vars (portal site): FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
// (client_email and private_key from the service-account JSON; keep them secret).

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

export const SITE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const ROLES = ["owner", "editor"];
export const INVITE_DAYS = 7;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

export const reply = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

export const preflight = () => new Response(null, { status: 204, headers: cors });

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function firebase() {
  if (!getApps().length) {
    const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
    if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
      throw new HttpError(500, "Invites aren't set up on this Netlify site. Add FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.");
    }
    initializeApp({
      credential: cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        // Netlify stores the key on one line with literal \n sequences.
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
      })
    });
  }
  return { auth: getAuth(), db: getFirestore() };
}

// Verifies the caller's Firebase ID token. Returns the decoded token.
export async function caller(req) {
  const idToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!idToken) throw new HttpError(401, "Sign in again, then retry.");
  try {
    return await firebase().auth.verifyIdToken(idToken, true);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(401, "Your session expired. Sign in again, then retry.");
  }
}

export const normEmail = e => String(e || "").trim().toLowerCase();
export const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;

// Wraps a handler: CORS preflight, POST only, JSON body, HttpError → JSON reply.
export const handler = fn => async req => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return reply(405, { error: "Use POST." });
  try {
    const body = await req.json().catch(() => ({}));
    return reply(200, await fn(req, body));
  } catch (err) {
    if (err instanceof HttpError) return reply(err.status, { error: err.message });
    console.error(err);
    return reply(500, { error: "Something went wrong. Try again in a minute." });
  }
};
