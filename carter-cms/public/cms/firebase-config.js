// Firebase web config: Firebase console → Project settings → Your apps → Web app.
// These values are safe to ship in the browser; access is enforced by firestore.rules and storage.rules.
export const firebaseConfig = {
  apiKey: "AIzaSyBFFqjp4ItmWK0NfNFwz-FFDHTAxQuLU7g",
  authDomain: "dropasite-2e317.firebaseapp.com",
  projectId: "dropasite-2e317",
  storageBucket: "dropasite-2e317.appspot.com",
  messagingSenderId: "511213771288",
  appId: "1:511213771288:web:3197281b1ec25fb418c16d",
};

// Which site this deployment renders. One Firebase project holds many client sites;
// each Netlify deploy of /public points at one of them.
export const SITE_ID = "dropasite-2e317";
