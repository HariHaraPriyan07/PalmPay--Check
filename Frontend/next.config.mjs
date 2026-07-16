/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Note: onnxruntime-web is intentionally NOT bundled — its runtime is
  // self-hosted under /public/ort and loaded by src/lib/ml/onnxProvider.ts via
  // script tag (the npm package supplies TypeScript types + the dist assets).
  // MediaPipe's wasm + hand model are likewise self-hosted under /public/mediapipe.

  // COOP + COEP enable SharedArrayBuffer (crossOriginIsolated), which ONNX
  // Runtime Web's simd-THREADED WASM build needs for performance.
  //
  // ⚠ COEP MUST be `credentialless`, NOT `require-corp`. `require-corp` blocks
  // every cross-origin subresource that lacks a CORP header — including Firebase
  // Auth's helper iframe on <project>.firebaseapp.com — which surfaces in the
  // browser as `auth/network-request-failed` (sign-in fails even though the
  // network is fine). `credentialless` still yields crossOriginIsolated=true /
  // working SharedArrayBuffer in Chromium & Firefox, but loads cross-origin
  // no-cors subresources without credentials instead of requiring CORP, so
  // Firebase (and other third-party requests) work. All our ONNX/MediaPipe
  // assets are same-origin (/ort, /mediapipe), so they're unaffected.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

export default nextConfig;

