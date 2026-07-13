# Real palm-recognition models (deployed)

The trained model is integrated. All four files are the SAME MobileNetV3-Large
network (256-D L2-normalized output, input `input` [batch,3,224,224] NCHW RGB,
output `embedding` [batch,256]) — only precision/quant format/dtype differ:

| File | Precision | I/O dtype | Used |
|---|---|---|---|
| `palm_int8_web.onnx` | INT8 (ConvInteger) | float32 | **DEFAULT** — browser, WASM EP |
| `palm_fp16_web.onnx` | FP16 | float16 | browser, WebGPU EP (`ENABLE_WEBGPU` flag) |
| `palm_256_l2_fp32.onnx` | FP32 | float32 | parity self-test ground truth only |
| `palm_int8_mobile.onnx` | INT8 (QDQ) | float32 | future native mobile app — never loaded in the browser |

Pairing is fixed: INT8↔WASM, FP16↔WebGPU — never crossed.

Selection logic + preprocessing contract: `src/lib/ml/config.ts` and
`src/lib/ml/onnxProvider.ts`. Verification threshold: **0.5216 (FAR 0.1%)**.
