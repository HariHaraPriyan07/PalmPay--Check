# CIT Palm Attendance

Palm-biometric daily attendance system for CIT CSE. This repo is split into two independent Node packages:

| Folder | What it is | Get started |
|---|---|---|
| [`Frontend/`](Frontend/README.md) | The Next.js app — UI, palm capture, ONNX Runtime Web recognition, Firebase client SDK. This is what advisors run day to day. | `cd Frontend && npm install && npm run dev` |
| `Backend/` | Firebase project config (Firestore/Storage rules, indexes) and Firebase Admin SDK scripts (seed demo data, assign role custom claims). Firebase itself is a managed backend (BaaS) — there is no separate server process here. | `cd Backend && npm install && npm run seed` |

See [`Frontend/README.md`](Frontend/README.md) for the full write-up: tech stack, the ML recognition pipeline, model files, verification threshold, anti-spoofing notes, and setup instructions.
