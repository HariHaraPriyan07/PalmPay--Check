/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Note: onnxruntime-web is intentionally NOT bundled — its runtime is
  // self-hosted under /public/ort and loaded by src/lib/ml/onnxProvider.ts via
  // script tag (the npm package supplies TypeScript types + the dist assets).
  // MediaPipe's wasm + hand model are likewise self-hosted under /public/mediapipe.
};

export default nextConfig;
