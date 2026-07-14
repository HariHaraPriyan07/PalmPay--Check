// Seed script (§13.4) — creates sections A–Q, demo users with custom claims,
// test students for sections A & B, and academic-calendar working days.
//
// Usage (real project):   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json npm run seed
// Usage (emulators):      FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//                         GCLOUD_PROJECT=demo-cit-palm npm run seed
//
// Demo password for all seeded users: Password@123  (change in production!)

import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync, existsSync } from "node:fs";

const SECTIONS = "ABCDEFGHIJKLMNOPQ".split("");
const DEMO_PASSWORD = "Password@123";
const SEEDED_STUDENT_SECTIONS = ["A", "B"]; // §13.4: "a couple of test sections"
const STUDENTS_PER_SECTION = 10;

// Working days: Monday–Friday from semester start through +3 months (adjust as needed).
const SEMESTER_START = new Date();
SEMESTER_START.setDate(1);
SEMESTER_START.setMonth(SEMESTER_START.getMonth() - 1);
const CAL_MONTHS = 4;

function initAdmin() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath && existsSync(credPath)) {
    const svc = JSON.parse(readFileSync(credPath, "utf8"));
    return initializeApp({ credential: cert(svc), projectId: svc.project_id });
  }
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-cit-palm" });
  }
  return initializeApp({ credential: applicationDefault() });
}

const app = initAdmin();
const auth = getAuth(app);
// This project's Firestore DB was created with a custom id ("default", not "(default)").
const db = getFirestore(app, process.env.FIREBASE_DATABASE_ID || "default");

async function upsertUser({ email, name, role, section }) {
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch {
    user = await auth.createUser({ email, password: DEMO_PASSWORD, displayName: name });
    console.log(`  created auth user ${email}`);
  }
  const claims = section ? { role, section } : { role };
  await auth.setCustomUserClaims(user.uid, claims);
  await db.doc(`users/${user.uid}`).set({
    uid: user.uid,
    email,
    role,
    name,
    ...(section ? { assignedSection: section } : {}),
  });
  return user.uid;
}

function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function main() {
  console.log("Seeding CIT Palm Attendance…");

  // ── Users (advisors for sections A & B + coordinator + HOD) ──
  console.log("Users + custom claims:");
  const advisorUids = {};
  for (const sec of SEEDED_STUDENT_SECTIONS) {
    advisorUids[sec] = await upsertUser({
      email: `advisor.${sec.toLowerCase()}@citchennai.net`,
      name: `Advisor Section ${sec}`,
      role: "advisor",
      section: sec,
    });
  }
  await upsertUser({
    email: "coordinator.cse@citchennai.net",
    name: "CSE Coordinator",
    role: "coordinator",
  });
  await upsertUser({
    email: "hod.cse@citchennai.net",
    name: "HOD CSE",
    role: "hod",
  });

  // ── Sections A–Q ──
  console.log("Sections A–Q:");
  let batch = db.batch();
  for (const sec of SECTIONS) {
    batch.set(db.doc(`sections/${sec}`), {
      sectionId: sec,
      advisorUid: advisorUids[sec] ?? "",
      year: 3,
      department: "CSE",
    });
  }
  await batch.commit();

  // ── Students for sections A & B ──
  console.log(`Students (${STUDENTS_PER_SECTION} each for ${SEEDED_STUDENT_SECTIONS.join(", ")}):`);
  const firstNames = ["Aarav", "Diya", "Vihaan", "Ananya", "Karthik", "Priya", "Rahul", "Sneha", "Arjun", "Meera"];
  batch = db.batch();
  for (const sec of SEEDED_STUDENT_SECTIONS) {
    for (let i = 1; i <= STUDENTS_PER_SECTION; i++) {
      const roll = `23CSE${sec}${String(i).padStart(3, "0")}`;
      batch.set(db.doc(`students/${roll}`), {
        studentId: roll,
        name: `${firstNames[(i - 1) % firstNames.length]} ${sec}${i}`,
        sectionId: sec,
        enrollmentStatus: "not_enrolled",
        consentGiven: false,
      });
    }
  }
  await batch.commit();

  // ── Academic calendar: Mon–Fri working days ──
  console.log("Academic calendar (Mon–Fri working):");
  const end = new Date(SEMESTER_START);
  end.setMonth(end.getMonth() + CAL_MONTHS);
  batch = db.batch();
  let n = 0;
  for (let d = new Date(SEMESTER_START); d < end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    const isWorkingDay = dow >= 1 && dow <= 5;
    batch.set(db.doc(`academicCalendar/${dateStr(d)}`), {
      date: dateStr(d),
      isWorkingDay,
      ...(isWorkingDay ? {} : { reason: "Weekend" }),
    });
    if (++n % 450 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  await batch.commit();
  console.log(`  ${n} calendar days written`);

  console.log("\nDone. Demo logins (password: " + DEMO_PASSWORD + "):");
  for (const sec of SEEDED_STUDENT_SECTIONS) {
    console.log(`  advisor.${sec.toLowerCase()}@citchennai.net  → Section ${sec} advisor`);
  }
  console.log("  coordinator.cse@citchennai.net → Coordinator (all sections)");
  console.log("  hod.cse@citchennai.net         → HOD (all sections)");
  console.log("\n⚠ Users must sign out/in (or refresh their ID token) after claim changes.");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
