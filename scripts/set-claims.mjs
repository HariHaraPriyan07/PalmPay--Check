// Assign a role (and section, for advisors) to an existing Firebase Auth user.
// Custom claims are what firestore.rules enforces — the users doc is display metadata.
//
// Usage:
//   node scripts/set-claims.mjs <email> advisor <SECTION A-Q> [name]
//   node scripts/set-claims.mjs <email> coordinator [name]
//   node scripts/set-claims.mjs <email> hod [name]
//
// Requires GOOGLE_APPLICATION_CREDENTIALS (or emulator env vars).

import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync, existsSync } from "node:fs";

const [email, role, ...rest] = process.argv.slice(2);
const ROLES = ["advisor", "coordinator", "hod"];

if (!email || !ROLES.includes(role)) {
  console.error("Usage: node scripts/set-claims.mjs <email> <advisor|coordinator|hod> [section] [name]");
  process.exit(1);
}
let section;
let name;
if (role === "advisor") {
  section = (rest[0] ?? "").toUpperCase();
  name = rest[1];
  if (!/^[A-Q]$/.test(section)) {
    console.error("Advisors need a section A–Q: node scripts/set-claims.mjs <email> advisor B");
    process.exit(1);
  }
} else {
  name = rest[0];
}

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const app =
  credPath && existsSync(credPath)
    ? initializeApp({
        credential: cert(JSON.parse(readFileSync(credPath, "utf8"))),
        projectId: JSON.parse(readFileSync(credPath, "utf8")).project_id,
      })
    : process.env.FIRESTORE_EMULATOR_HOST
      ? initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-cit-palm" })
      : initializeApp({ credential: applicationDefault() });

const auth = getAuth(app);
const db = getFirestore(app);

const user = await auth.getUserByEmail(email);
await auth.setCustomUserClaims(user.uid, section ? { role, section } : { role });
await db.doc(`users/${user.uid}`).set(
  {
    uid: user.uid,
    email,
    role,
    name: name ?? user.displayName ?? email,
    ...(section ? { assignedSection: section } : {}),
  },
  { merge: true },
);
if (role === "advisor") {
  await db.doc(`sections/${section}`).set(
    { sectionId: section, advisorUid: user.uid, year: 3, department: "CSE" },
    { merge: true },
  );
}
console.log(`Set ${email} → role=${role}${section ? ` section=${section}` : ""}.`);
console.log("⚠ The user must sign out and back in for the new claims to take effect.");
