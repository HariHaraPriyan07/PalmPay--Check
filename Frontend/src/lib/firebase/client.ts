import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  type Firestore,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

function getApp(): FirebaseApp {
  if (!app) {
    app = getApps()[0] ?? initializeApp(firebaseConfig);
  }
  return app;
}

const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === "1";

// This project's Firestore database was created with a custom database ID ("default",
// without parentheses) rather than the real default "(default)". The Web SDK targets
// "(default)" unless told otherwise, so we must pass the actual database ID here or every
// read hangs against a non-existent database. Override via env if it ever changes.
const databaseId = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || "default";

export function getFirebaseAuth(): Auth {
  if (!authInstance) {
    authInstance = getAuth(getApp());
    if (useEmulators) {
      connectAuthEmulator(authInstance, "http://127.0.0.1:9099", { disableWarnings: true });
    }
  }
  return authInstance;
}

export function getDb(): Firestore {
  if (!dbInstance) {
    // Auto-detect long-polling: the default WebChannel/gRPC streaming transport is
    // silently blocked by some networks/proxies/VPNs/antivirus, which makes reads hang.
    // Long-polling falls back to plain HTTP requests that get through.
    try {
      dbInstance = initializeFirestore(
        getApp(),
        { experimentalAutoDetectLongPolling: true },
        databaseId,
      );
    } catch {
      // initializeFirestore throws if Firestore was already initialized for this app.
      dbInstance = getFirestore(getApp(), databaseId);
    }
    if (useEmulators) {
      connectFirestoreEmulator(dbInstance, "127.0.0.1", 8080);
    }
  }
  return dbInstance;
}
