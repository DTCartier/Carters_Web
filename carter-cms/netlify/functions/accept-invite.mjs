// POST /.netlify/functions/accept-invite — used by /admin/accept.html.
// Body: { siteId, inviteId, action }
//   peek   (no sign-in) → { status, siteName, email, role }  so the page can show what the invite is for
//   accept (signed in)  → { siteId, siteName, role }          adds the caller to the site's team
// Accepting requires a verified email that matches the invite, so a forwarded link is useless
// to anyone who can't read that inbox.

import { FieldValue } from "firebase-admin/firestore";
import { handler, caller, firebase, HttpError, SITE_ID, normEmail } from "../lib/admin.mjs";

function inviteStatus(v) {
  if (v.status === "pending" && v.expiresAt.toMillis() <= Date.now()) return "expired";
  return v.status === "replaced" ? "revoked" : v.status;
}

export default handler(async (req, body) => {
  const { siteId, inviteId, action } = body;
  if (!SITE_ID.test(siteId || "") || !/^[\w-]{20,64}$/.test(inviteId || "")) {
    throw new HttpError(404, "This invite link isn't valid. Ask for a new one.");
  }
  const { db } = firebase();
  const membersRef = db.doc(`siteMembers/${siteId}`);
  const inviteRef = membersRef.collection("invites").doc(inviteId);

  if (action === "peek") {
    const snap = await inviteRef.get();
    if (!snap.exists) throw new HttpError(404, "This invite link isn't valid. Ask for a new one.");
    const v = snap.data();
    return { status: inviteStatus(v), siteName: v.siteName, email: v.email, role: v.role };
  }

  if (action !== "accept") throw new HttpError(400, "Unknown action.");

  const user = await caller(req);
  return db.runTransaction(async tx => {
    const [invite, members] = await Promise.all([tx.get(inviteRef), tx.get(membersRef)]);
    if (!invite.exists || !members.exists) throw new HttpError(404, "This invite link isn't valid. Ask for a new one.");
    const v = invite.data();
    const status = inviteStatus(v);
    if (status !== "pending") {
      throw new HttpError(410, status === "accepted" ? "This invite has already been used." : `This invite is ${status}. Ask for a new one.`);
    }
    if (normEmail(user.email) !== v.email) {
      throw new HttpError(403, `This invite is for ${v.email}. Sign in with that email to accept it.`);
    }
    if (user.email_verified !== true) throw new HttpError(403, "Verify your email first, then accept the invite.");

    // Never downgrade: an existing owner who accepts an editor invite stays an owner.
    const current = members.data().roles?.[user.uid];
    const role = current === "owner" ? "owner" : v.role;
    tx.update(membersRef, { memberIds: FieldValue.arrayUnion(user.uid), [`roles.${user.uid}`]: role });
    tx.update(inviteRef, { status: "accepted", acceptedBy: user.uid, acceptedAt: FieldValue.serverTimestamp() });
    return { siteId, siteName: v.siteName, role };
  });
});
