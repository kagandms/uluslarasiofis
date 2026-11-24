# MediaPipe face detector model (vendored)

- **Date:** 2026-11-23. **Status:** in use by the YKN automatic chain (passport face crop).
- **File:** `blaze_face_short_range.tflite` (229 746 bytes,
  SHA-256 `b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f`).
- **Source:** Google MediaPipe model bucket,
  `https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`
  (Apache-2.0, same licence as `@mediapipe/tasks-vision`).
- **Why it is kept in Git:** the model is not part of the npm package, and the owner decided
  (2026-11-23) that face detection must run from our own site with no external CDN, so passport
  images never leave the staff browser. Chrome's built-in `FaceDetector` is not available in
  normal Chrome.
- **How it is served:** the Vite plugin in `vite.config.js` serves this file and the
  `@mediapipe/tasks-vision` WASM files under `/mediapipe-support/<version>/` in development and
  emits them into the production build.
- **Updating:** download the new file, update size and checksum here, and bump the path version.
