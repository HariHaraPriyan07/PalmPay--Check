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
`src/lib/ml/onnxProvider.ts`. Verification threshold: **0.5346 (FAR 0.1%)**.
