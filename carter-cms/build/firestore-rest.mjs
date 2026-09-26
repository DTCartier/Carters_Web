// Minimal Firestore REST client (no SDK, no service account).
// Reads go through the same security rules as the browser: anonymous calls see only public data,
// calls with a user's ID token see what that user is allowed to see.

const base = projectId =>
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

export function decodeValue(v = {}) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("mapValue" in v) return decodeFields(v.mapValue.fields);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
  if ("referenceValue" in v) return v.referenceValue;
  if ("geoPointValue" in v) return v.geoPointValue;
  if ("bytesValue" in v) return v.bytesValue;
  return undefined;
}

export const decodeFields = (fields = {}) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decodeValue(v)]));

const toDoc = d => ({ id: d.name.split("/").pop(), ...decodeFields(d.fields) });

async function fail(res, what) {
  const err = new Error(`Firestore returned ${res.status} for ${what}: ${await res.text()}`);
  err.status = res.status;
  throw err;
}

// Returns the document, or null if it doesn't exist.
export async function getDocument({ projectId, apiKey, path, idToken }) {
  const url = `${base(projectId)}/${path}${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ""}`;
  const res = await fetch(url, { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} });
  if (res.status === 404) return null;
  if (!res.ok) await fail(res, path);
  return toDoc(await res.json());
}

// Equality query on one string field, e.g. where: ["status", "published"].
export async function queryEquals({ projectId, apiKey, parent, collectionId, where: [field, value] }) {
  const url = `${base(projectId)}/${parent}:runQuery${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: { fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: { stringValue: value } } }
      }
    })
  });
  if (!res.ok) await fail(res, `${parent}/${collectionId}`);
  return (await res.json()).filter(r => r.document).map(r => toDoc(r.document));
}
