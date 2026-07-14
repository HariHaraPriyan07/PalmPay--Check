# CIT Palm Attendance — CSE Department

Daily student attendance for **Chennai Institute of Technology, CSE 3rd year (sections A–Q, 17 sections, 1000+ students)** where the student's **palm is the credential**. A class advisor selects a student from their roster, the student shows their palm to the laptop webcam, and the system verifies it against that student's stored palm embedding (**1:1 match**). Verified students are auto-marked present; everyone else is marked manually (Absent / OD / Others-with-reason).

**Purpose:** validate that palm-embedding recognition (the approach from the PalmPay project) is accurate and fast enough for real daily use. The system is instrumented so accuracy (FAR/FRR) and latency can actually be measured — recognition is not faked.

> ### ✅ The REAL recognition model is integrated
> Matching now runs on the trained **MobileNetV3-Large → 256-D palm embedding** network via
> **ONNX Runtime Web**, with the calibrated verification threshold **0.5346 (FAR 0.1%)**.
> The old deterministic placeholder (`src/lib/ml/placeholderProvider.ts`) is kept only as a
> flow-testing fallback behind `USE_PLACEHOLDER_PROVIDER` (now `false`). Templates enrolled
> with the placeholder (`modelVersion: placeholder-v1`) are incompatible — re-enroll those
> students; verification shows a warning when it meets one. See [The deployed model](#the-deployed-model).
>
> **INT8 is not used.** Quantization drift testing rejected both INT8 exports (mean cosine
> ~0.70 vs fp32 reference — see `deploy_config.json`); production routes FP16 on WebGPU
> (primary) with FP32 on WASM as the fallback.

---

## Tech stack (fixed)

| Layer | Choice |
|---|---|
| Frontend | React + **Next.js 14** (App Router) |
| Styling | **Tailwind CSS**, tokens from `design-system/MASTER.md` |
| Palm detection | **MediaPipe Hands** (`@mediapipe/tasks-vision`, in-browser) |
| Recognition | **ONNX Runtime Web** (client-side, self-hosted runtime) — trained MobileNetV3-Large, 256-D L2-normalized embedding, cosine ≥ 0.5346 (FAR 0.1%). FP16 on WebGPU by default, FP32 on WASM fallback (INT8 rejected — quantization drift). |
| Auth | **Firebase Authentication** (email/password + custom claims) |
| Database | **Cloud Firestore** (security rules enforce access) |
| Storage | **Firebase Storage** — optional research-only enrollment images (consent-gated) |

## Repository layout

This is `Frontend/` — the Next.js app (see the [repo root README](../README.md) for the
`Backend/` package: Firebase rules + Admin SDK scripts).

```
design-system/MASTER.md         ← design single source of truth (UI UX Pro Max)
src/lib/ml/                     ← THE SWAPPABLE ML SEAM (see below)
src/lib/capture/                ← MediaPipe detection, ROI, quality gates, liveness
src/lib/db/                     ← Firestore data access (batched per section)
src/app/advisor/…               ← advisor dashboard, attendance, enrollment
src/app/overview, /calendar     ← coordinator/HOD roll-up + academic calendar
public/models/                  ← the trained .onnx builds (see MODELS.md there)
public/ort/                     ← self-hosted ONNX Runtime Web assets (no CDN at first use)
public/mediapipe/               ← self-hosted MediaPipe wasm + hand_landmarker.task

../Backend/firestore.rules      ← role + section isolation, enforced server-side
../Backend/storage.rules        ← optional enrollment images, advisor-only
../Backend/scripts/seed.mjs     ← sections A–Q, demo users+claims, students, calendar
../Backend/scripts/set-claims.mjs ← assign role/section claims to real users
```

---

## Setup

### 1. Firebase project

1. Create a Firebase project → enable **Authentication (Email/Password)** and **Cloud Firestore**.
2. Add a Web app; copy the config into `.env.local` (template: `.env.local.example`).
3. Deploy rules + indexes (from `Backend/`, where `firebase.json` lives):
   ```bash
   cd ../Backend
   firebase deploy --only firestore:rules,firestore:indexes,storage
   ```
4. Download a service-account key (Project settings → Service accounts) to `Backend/serviceAccountKey.json` (gitignored).

### 2. Seed data & roles

```bash
cd ../Backend
npm install
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json npm run seed
```

Seeds sections A–Q, Mon–Fri working days into `academicCalendar`, 10 test students each for sections A & B, and demo users (password `Password@123` — change in production):

| Login | Role |
|---|---|
| `advisor.a@citchennai.net` | Advisor, Section A only |
| `advisor.b@citchennai.net` | Advisor, Section B only |
| `coordinator.cse@citchennai.net` | Coordinator — all 17 sections |
| `hod.cse@citchennai.net` | HOD — all 17 sections |

Real users: create them in Firebase Auth, then (from `Backend/`)
`node scripts/set-claims.mjs advisor.c@citchennai.net advisor C "Advisor Name"`.
**Claims changes take effect after the user signs out and back in.**

### 3. Run

```bash
npm install
npm run dev        # http://localhost:3000
```

Fully local alternative (no cloud project): from `Backend/`, run `npm run emulators`; in
`Frontend/.env.local` set `NEXT_PUBLIC_USE_EMULATORS=1`; then seed with
`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GCLOUD_PROJECT=demo-cit-palm npm run seed`
(run from `Backend/`; any non-empty values work for the `NEXT_PUBLIC_FIREBASE_*` vars in emulator mode).

> MediaPipe's wasm + hand model and the ONNX Runtime Web assets are **self-hosted** under `/public/mediapipe` and `/public/ort` — no CDN fetch when the camera first opens (the earlier first-use timeout on classroom networks was exactly that). Camera access requires `localhost` or HTTPS.

---

## Roles & access control

- **Class advisor** — sees, enrolls, and takes attendance for **only their own section** (custom claim `{role:'advisor', section:'X'}`).
- **CSE Coordinator / HOD** — identical full **read** access across all 17 sections + reporting. They can also maintain the academic calendar. They can **not** read palm embeddings.
- Enforcement lives in **`../Backend/firestore.rules`** (custom claims), not just the UI. The rules also enforce: one attendance doc per student per day (doc id `date_studentId`), valid statuses, **required reason for `others`**, and 256-length embedding arrays.

## Data model (Firestore)

`users`, `sections` (A–Q), `students` (incl. `consentGiven`/`consentTimestamp`), `embeddings` (**the matching credential: 256 floats + `modelVersion` + `qualityScore` — never raw images**), `attendanceRecords` (one per student per day; `status ∈ present|absent|od|others`, `reason` required for `others`, `method ∈ palm|manual`, `similarityScore`+`livenessScore` for palm marks), `academicCalendar` (drives working-day counting), `attendanceSummary` (derived running %), `verificationEvents` (append-only instrumentation).

## Attendance policy (§ the 85% rule)

- `percentage = presentCount / workingDaysSoFar` where **workingDaysSoFar counts only `academicCalendar` docs with `isWorkingDay: true`** — holidays and unmarked days can never reduce a student's %.
- **OD rule (single, configurable):** `OD_COUNTS_AS_PRESENT = true` in `src/lib/config/app.ts` — OD counts as present/excused. Flip once, applies everywhere.
- `belowThreshold` flips when % < **85** (`ATTENDANCE_THRESHOLD_PERCENT`). Below-85 students are surfaced on the advisor dashboard and the coordinator/HOD overview (with CSV export).
- Attendance is tied to the **calendar date** — normally taken before 1st hour but allowed any time that working day. Same-day correction = overwrite of the same doc; duplicates are structurally impossible.

---

## The ML seam (read before touching recognition)

Everything recognition-related sits behind **one interface** in `src/lib/ml/embeddingProvider.ts`:

```ts
getEmbedding(input: PreprocessedInput): Promise<Float32Array>  // 256-D, L2-normalized
```

The provider is created **once per session and kept warm** so daily 1:1 matching feels instant. Enrollment averages 10 frame-embeddings (re-normalized); verification averages 5 and takes cosine similarity against the one stored template.

### The deployed model

One trained **PyTorch MobileNetV3-Large** network, exported as ONNX builds with an
**identical I/O contract**: input `input` `[batch, 3, 224, 224]` (NCHW, **RGB**) → output
`embedding` `[batch, 256]`, **L2-normalized in-graph** (the app never re-normalizes model output).

| Config key | File | Precision | I/O dtype | Used on |
|---|---|---|---|---|
| `web_webgpu` | `palm_fp16_web.onnx` | FP16 | **float16** | Browser, **WebGPU EP** — **PRIMARY** when `ENABLE_WEBGPU` and the browser supports it |
| `web_wasm` | `palm_256_l2_fp32.onnx` | FP32 | float32 | Browser, **WASM EP** — **FALLBACK**, works on every advisor laptop |
| `reference_fp32` | `palm_256_l2_fp32.onnx` | FP32 | float32 | Parity self-test ground truth |

**INT8 is not used.** `palm_int8_web.onnx` and `palm_int8_mobile.onnx` have been removed from
`public/models/` — `deploy_config.json`'s quantization-drift test rejected both
(`int8_viable: false`; mean cosine ~0.70, min ~0.47 against the fp32 reference — MobileNetV3
SE-blocks are quantization-fragile). Any templates built while INT8 was mistakenly in use must be
re-enrolled against the fp16/fp32 path.

All variants are the same trained network, so templates are compatible across variants; each
template still records the exact build that produced it (`modelVersion`, e.g.
`palm-mnv3l-256-v1-fp16webgpu`) for auditing and future migration.

### Preprocessing (locked — matches training exactly)

For each palm ROI, **only** these steps (`src/lib/ml/preprocess.ts`, constants in `config.ts`):
resize **224×224** → **RGB** → scale **÷255** → ImageNet normalize
(`mean [0.485, 0.456, 0.406]`, `std [0.229, 0.224, 0.225]`) → **NCHW** → cast to the model's
input dtype (float32, or float16 for the fp16 build).

> ⚠ **NO CLAHE AT INFERENCE.** CLAHE was train-time augmentation only. Applying it (or any
> gamma/histogram/illumination/edge op) at inference silently corrupts embeddings and degrades
> matching. If matching quality ever mysteriously drops, check this first.

### ML constants (`src/lib/ml/config.ts`)

| Constant | Meaning | Current |
|---|---|---|
| `VERIFICATION_THRESHOLD` | accept when cosine(probe, template) ≥ this — **calibrated at FAR 0.1%** | **0.5346** |
| `RETRY_MARGIN` / `RETRY_THRESHOLD` | tunable retry band just below accept (reposition & retry) | 0.05 → 0.4846 |
| `MODEL_FAMILY` / `MODEL_VERSION` | network+dim+release / default deployed build | `palm-mnv3l-256-v1` / `…-fp32wasm` |
| `ENABLE_WEBGPU` | FP16-on-WebGPU primary (auto-fallback to FP32-on-WASM) | `true` |
| `USE_PLACEHOLDER_PROVIDER` | flow-testing placeholder (not biometric) | `false` |
| `INPUT_NAME`/`OUTPUT_NAME`/`INPUT_SIZE`/`CHANNEL_ORDER`/`LAYOUT`/`SCALE`/`NORMALIZE_MEAN`/`NORMALIZE_STD`/`OUTPUT_IS_L2_NORMALIZED` | the locked I/O + preprocessing contract | see file |
| `ENROLL_FRAME_COUNT` / `VERIFY_FRAME_COUNT` | frames per capture | 10 / 5 |

**Genuine scores sit around/above ~0.52 in this embedding space, not ~0.9 — that is the correct
scale for the calibrated operating point.** Do not rescale scores to look higher, and do not
resurrect the old placeholder thresholds (0.92/0.80 — removed).

Enrollment (§5): each of the ~10 quality-passed frames is embedded; the template is the
**elementwise mean of the per-frame L2-normalized embeddings, re-normalized to unit length**
(`averageEmbeddings` in `src/lib/ml/cosine.ts`). Verification compares a probe embedding to the
stored template via cosine (dot product of unit vectors).

Capture quality gates live in `src/lib/capture/quality.ts` (palm detected, centered, open, size, brightness, Laplacian blur) and liveness heuristics in `src/lib/capture/liveness.ts` — all named constants.

### Parity self-test

In the browser dev console: `await window.__palmParitySelfTest()`. It pushes a **fixed synthetic
image** through the app's real preprocessing into **both** the active production build (fp16 on
WebGPU, or fp32 on WASM fallback) and `palm_256_l2_fp32.onnx` (ground truth) and logs the cosine
between the two embeddings. **Expect ~0.99+.** A large gap means the pipeline is wrong — most
likely a forgotten ÷255, swapped mean/std, BGR vs RGB, or CLAHE accidentally applied at inference.
Also available: `await window.__palmPairCheck(canvasA, canvasB)` — same-palm pairs should score
≥ 0.5346, different-palm pairs below it.

> **Quantization drift (from `deploy_config.json`):** `cosine(fp16_web, fp32_ref)` mean
> `0.999715`, min `0.999414` — comfortably clears the `0.99` bar. `cosine(int8, fp32_ref)` mean
> `0.699`, min `0.469` on both INT8 exports — **fails badly**, which is why INT8 is excluded from
> routing entirely (`int8_viable: false`).

### Accuracy measurement (now meaningful)

- **Every verification attempt** is logged to `verificationEvents` (similarity, accept/retry/reject, quality, liveness, `modelVersion`), and every palm mark stores its `similarityScore`. With the real model in, genuine-vs-imposter score distributions from this log give **FRR** (genuine attempts rejected) and, with deliberate cross-student trials, **FAR** — measured over the term, this is the whole point of the project (proving PalmPay-grade accuracy). Keep this logging on.
- **FAR 0.1%** means: at the 0.5346 threshold, about 1 in 1000 impostor attempts would score high enough to match — the calibrated trade-off against false rejections of genuine students.
- Numbers collected earlier under the placeholder (`modelVersion: placeholder-v1`) prove only that the pipeline works — never quote them as biometric accuracy.

---

## Anti-spoofing: what is and isn't covered

Capture is a **plain RGB laptop webcam — no depth, no IR. Spoofing is NOT impossible and we do not claim it is.** The real model changes nothing here: **matching is now real and calibrated at FAR 0.1%, but the recognition model adds no hardware liveness — spoof resistance on a plain RGB webcam remains best-effort with documented residual risk.** Passive defenses (`src/lib/capture/liveness.ts`):

- **Micro-motion check** — accepted frames are temporally spaced; a static print or a paused phone-screen image produces near-identical frames and is rejected.
- **Texture check** — flat prints / re-photographed screens lose mid/high-frequency texture (Laplacian variance).
- **Glare heuristic** — emissive screens tend to clip highlights; a high fraction of near-max luma pixels is flagged.
- A **liveness score is logged with every palm mark**, and a failed liveness check can never auto-accept (it demotes to retry). Enrollment rejects flagged captures outright.

**Residual risk (honest):** a high-quality replay *video* on a good screen, careful print+movement attacks, or a mold can defeat RGB-only heuristics. Mitigations that would materially help: IR/depth camera, challenge-response gestures, and the advisor physically supervising the scan (which this flow assumes — the advisor selects the student and watches the capture).

## Privacy

- Consent screen **before any capture**; `consentGiven` + timestamp recorded; no consent → no enrollment.
- **Only embeddings are stored for matching** — raw palm images are never persisted by the app. (Optional research retention would live in Firebase Storage under `enrollmentImages/`, consent-gated and section-isolated by `../Backend/storage.rules`; not enabled in the UI.)
- Embeddings are readable **only** by the owning section's advisor — not by other advisors, not by coordinator/HOD.
- Deleting a student's biometric data = delete `embeddings/{studentId}` (helper: `deleteStudentEmbedding`), then mark the student `not_enrolled`.

## Performance notes

- 1:1 match = one cosine over 256 floats — microseconds; capture dominates. The provider and MediaPipe detector are loaded once and kept warm.
- Roster + today's records load as **one query each**; attendance marks are single-doc writes; summary recompute is **debounced (4 s)** during a ~60-student scan burst and batched (≤450 writes/batch) — this is what keeps 17 sections marking in the same morning window responsive.

---

## UI/UX tooling (how the three tools were used)

1. **UI UX Pro Max** (design authority) — installed via `npm i -g ui-ux-pro-max-cli && uipro init --ai antigravity` (skills in `../.agents/skills/`). The design system was generated with
   `python ../.agents/skills/ui-ux-pro-max/scripts/search.py "institutional dashboard trustworthy accessible professional data-dense calm light mode" --design-system --persist -p "CIT Palm Attendance"`
   (persisted raw output: `design-system/cit-palm-attendance/`), then consolidated into **`design-system/MASTER.md` — the single source of truth**: Data-Dense Dashboard style, institutional blue `#1E40AF` + amber accent, Fira Code/Fira Sans, WCAG AA, light mode.
2. **21st.dev** (component generator, via MCP in Antigravity) — used for functional component shapes (data tables, form rows, modal patterns). Its output is **not** a design authority: everything was restyled to MASTER tokens in `src/components/ui/`. To reconnect the MCP server in Antigravity: settings → MCP → add `https://21st.dev` magic MCP with your API key.
3. **Aether UI** (component library) — animated pieces (login hero treatment, stat cards, modal transitions) follow Aether UI patterns rebuilt on Framer Motion in `src/components/ui/motion.tsx` / `Modal.tsx`, conformed to MASTER tokens. `components.json` is configured, so additional components can be pulled with
   `npx shadcn@latest add "https://aetherui.in/c/<component>.json"` — **restyle anything you pull to MASTER.md tokens.** Animations are subtle and respect `prefers-reduced-motion`.

Accessibility: keyboard navigable, visible focus rings, ≥4.5:1 contrast pairs, Lucide SVG icons (no emoji icons), reduced-motion respected globally.

## Error handling covered

Camera denied/missing/busy → actionable message + retry; no palm / palm too small / off-center / fist / too dark / too bright / blurred → live per-frame hints; detector or model load failure (offline) → explicit error with cause; Firestore write failures → inline row errors; non-working day → attendance blocked with explanation; not-enrolled student → verify disabled with tooltip + manual fallback; duplicate day-records → structurally impossible; 'Others' without reason → blocked client-side **and** by rules.
