// Gives someone access to one site. Creates their login if they don't have one yet
// and prints a link they can use to set their password.
// Usage: node add-member.js client@example.com site-id owner|editor
const crypto = require("crypto");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");

const [email, siteId, role = "editor"] = process.argv.slice(2);
if (!email || !siteId || !["owner", "editor"].includes(role)) {
  console.error("Usage: node add-member.js client@example.com site-id owner|editor");
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(require("./service-account.json")) });
const auth = admin.auth();
const db = admin.firestore();

(async () => {
  const site = await db.doc(`sites/${siteId}`).get();
  if (!site.exists) throw new Error(`No site with the ID "${siteId}". Create it in /admin first.`);

  let user, created = false;
  try {
    user = await auth.getUserByEmail(email);
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
    user = await auth.createUser({ email, password: crypto.randomBytes(24).toString("base64url") });
    created = true;
  }

  await db.doc(`siteMembers/${siteId}`).set({
    siteName: site.data().name || siteId,
    memberIds: FieldValue.arrayUnion(user.uid),
    roles: { [user.uid]: role }
  }, { merge: true });

  console.log(`${email} is now ${role === "owner" ? "an owner" : "an editor"} of ${siteId}.`);
  if (created) {
    const link = await auth.generatePasswordResetLink(email);
    console.log(`New account. Send them this link to set a password:\n${link}`);
  }
})().catch(err => { console.error(err.message); process.exit(1); });
