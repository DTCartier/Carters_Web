// Makes an existing Firebase Auth user a platform admin (full access to every site).
// Usage: node set-admin.js you@example.com
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const email = process.argv[2];
if (!email) {
  console.error("Usage: node set-admin.js you@example.com");
  process.exit(1);
}

initializeApp({
  credential: cert(require("./service-account.json")),
});

(async () => {
  const auth = getAuth();
  const user = await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(user.uid, {
    ...(user.customClaims || {}),
    platformAdmin: true,
  });
  console.log(
    `${email} is now a platform admin. Sign out of /admin and back in to pick it up.`,
  );
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
