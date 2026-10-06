// POST /.netlify/functions/team — site owners (and platform admins) manage who can edit a site.
// Body: { siteId, action, ... }
//   list                      → { members: [{uid, email, role}], invites: [{id, email, role, expiresAt}] }
//   invite  { email, role }   → { invite: {id, email, role, expiresAt} }  (replaces a pending invite for that email)
//   revoke  { inviteId }
//   setRole { uid, role }
//   remove  { uid }
// A site always keeps at least one owner.
//
// Invites live at siteMembers/{siteId}/invites/{inviteId}. Firestore rules don't match that path,
// so browsers can't read or write them; only these functions can.

import crypto from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { handler, caller, firebase, HttpError, SITE_ID, ROLES, INVITE_DAYS, normEmail, validEmail } from "../lib/admin.mjs";

const MAX_PENDING = 25;

const ownerCount = roles => Object.values(roles || {}).filter(r => r === "owner").length;

function checkRole(role) {
  if (!ROLES.includes(role)) throw new HttpError(400, "Role must be owner or editor.");
}

function inviteOut(d) {
  const v = d.data();
  return { id: d.id, email: v.email, role: v.role, expiresAt: v.expiresAt.toDate().toISOString() };
}

export default handler(async (req, body) => {
  const user = await caller(req);
  const { siteId, action } = body;
  if (!SITE_ID.test(siteId || "")) throw new HttpError(400, "Missing site.");

  const { auth, db } = firebase();
  const membersRef = db.doc(`siteMembers/${siteId}`);
  const invitesCol = membersRef.collection("invites");

  const members = await membersRef.get();
  if (!members.exists) throw new HttpError(404, "This site has no member list. Recreate it from /admin.");
  const roles = members.data().roles || {};
  if (user.platformAdmin !== true && roles[user.uid] !== "owner") {
    throw new HttpError(403, "Only site owners can manage the team.");
  }

  if (action === "list") {
    const uids = members.data().memberIds || [];
    const found = uids.length ? (await auth.getUsers(uids.map(uid => ({ uid })))).users : [];
    const emails = Object.fromEntries(found.map(u => [u.uid, u.email || ""]));
    const pending = await invitesCol.where("status", "==", "pending").get();
    const now = Date.now();
    return {
      members: uids.map(uid => ({ uid, email: emails[uid] || "(deleted account)", role: roles[uid] || "editor" }))
        .sort((a, b) => a.email.localeCompare(b.email)),
      invites: pending.docs.filter(d => d.data().expiresAt.toMillis() > now).map(inviteOut)
        .sort((a, b) => a.email.localeCompare(b.email))
    };
  }

  if (action === "invite") {
    const email = normEmail(body.email);
    const role = body.role || "editor";
    if (!validEmail(email)) throw new HttpError(400, "Enter a valid email address.");
    checkRole(role);

    const existing = await auth.getUserByEmail(email).catch(err => {
      if (err.code === "auth/user-not-found") return null;
      throw err;
    });
    if (existing && roles[existing.uid]) throw new HttpError(409, `${email} is already on this site's team.`);

    const pending = await invitesCol.where("status", "==", "pending").get();
    const same = pending.docs.filter(d => d.data().email === email);
    if (pending.size - same.length >= MAX_PENDING) {
      throw new HttpError(429, `This site has ${MAX_PENDING} open invites. Revoke some before sending more.`);
    }

    const id = crypto.randomBytes(24).toString("base64url");
    const ref = invitesCol.doc(id);
    const batch = db.batch();
    same.forEach(d => batch.update(d.ref, { status: "replaced" }));
    batch.set(ref, {
      email, role, status: "pending",
      siteName: members.data().siteName || siteId,
      createdBy: user.uid, createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + INVITE_DAYS * 864e5)
    });
    await batch.commit();
    return { invite: inviteOut(await ref.get()) };
  }

  if (action === "revoke") {
    const ref = invitesCol.doc(String(body.inviteId || "_"));
    const snap = await ref.get();
    if (!snap.exists || snap.data().status !== "pending") throw new HttpError(404, "That invite is no longer open.");
    await ref.update({ status: "revoked", revokedBy: user.uid, revokedAt: FieldValue.serverTimestamp() });
    return { ok: true };
  }

  if (action === "setRole" || action === "remove") {
    const uid = String(body.uid || "");
    if (action === "setRole") checkRole(body.role);
    await db.runTransaction(async tx => {
      const snap = await tx.get(membersRef);
      const current = snap.data().roles || {};
      if (!current[uid]) throw new HttpError(404, "That person isn't on this site's team.");
      const losingOwner = current[uid] === "owner" && (action === "remove" || body.role !== "owner");
      if (losingOwner && ownerCount(current) < 2) {
        throw new HttpError(409, "A site needs at least one owner. Make someone else an owner first.");
      }
      tx.update(membersRef, action === "remove"
        ? { memberIds: FieldValue.arrayRemove(uid), [`roles.${uid}`]: FieldValue.delete() }
        : { [`roles.${uid}`]: body.role });
    });
    return { ok: true };
  }

  throw new HttpError(400, "Unknown action.");
});
