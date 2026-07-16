# Real palm-recognition models (deployed)

The trained model is integrated. All files are the SAME MobileNetV3-Large
network (256-D L2-normalized output, input `input` [batch,3,224,224] NCHW RGB,
output `embedding` [batch,256]) — only precision/quant format/dtype differ:

| File | Precision | I/O dtype | Used |
|---|---|---|---|
| `palm_fp16_web.onnx` | FP16 | float16 | **PRIMARY** — browser, WebGPU EP (`ENABLE_WEBGPU` flag) |
| `palm_256_l2_fp32.onnx` | FP32 | float32 | **FALLBACK** — browser, WASM EP; also the parity self-test ground truth |

Per `deploy_config.json`, `int8_viable: false` — both INT8 exports
(`palm_int8_web.onnx`, `palm_int8_mobile.onnx`) failed quantization-drift
testing (mean cosine ~0.70, min ~0.47 against the fp32 reference; MobileNetV3
SE-blocks are quantization-fragile) and have been removed from this folder.
Any templates built while INT8 was mistakenly in use must be re-enrolled
against the fp16/fp32 path.

Selection logic + preprocessing contract: `src/lib/ml/config.ts` and
`src/lib/ml/onnxProvider.ts`.

## ⚠ Scoring: mean-centering is REQUIRED (do not score on raw cosine)

This backbone's raw 256-D outputs share a dominant common direction: unrelated
palms score cosine ~0.6–0.97 against each other, so genuine and impostor
distributions **overlap** and NO fixed raw-cosine threshold separates people
(measured: 13/14 impostors clear 0.5346 → "matches all hands"). Verification
therefore scores in the **mean-centered space** (`src/lib/ml/centering.ts`):

- Templates are stored **raw**; probe + template are centered against the
  section's population mean (mean of that section's enrolled templates) at match
  time, then compared. Same model → same fix; no re-enrollment as the mean
  improves.
- Accept/retry thresholds are **impostor-cohort-relative** (T-norm style):
  `impostorMean + Z·impostorStd`, measured from the section's cross-student
  template pairs each session, clamped to a guardrail band. This self-locates
  the boundary above the impostor cloud instead of a fixed cosine.
- After centering: 0/14 impostors clear the bar in the same test; genuine ≈ 0.99.

The old fixed `VERIFICATION_THRESHOLD = 0.5346` is now only a raw-cosine
**fallback** used when a section has too few templates to center — documented
unreliable. **Calibrate the real operating point** on enrolled palms via
`await window.__palmScoring("A")` and tune `ACCEPT_Z` / clamps in `config.ts`.

## Handedness + liveness

- **Left vs right**: MediaPipe handedness is stored on each template and the
  same hand is required at verification (mirror-image hands can otherwise score
  alike). Labels are self-consistent enroll↔verify.
- **Anti-photo liveness**: primary signal is **non-rigidity** — a live hand's
  landmark geometry micro-deforms frame to frame; a photo (still or moved) is
  rigid. `MIN_NONRIGIDITY` in `liveness.ts` is provisional — tune vs a real
  printed/phone photo on-device.
