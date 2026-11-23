/**
 * @fileoverview Kendi sitemizden sunulan MediaPipe FaceDetector sarmalayıcısı.
 * Görüntüler tarayıcı dışına çıkmaz; WASM ve model dosyaları yalnızca ilk kullanımda tembel yüklenir.
 */

import { MEDIAPIPE_SUPPORT_URL } from '../config/mediapipe-version.js';

const MODEL_FILE_NAME = 'blaze_face_short_range.tflite';
const DEFAULT_MIN_DETECTION_CONFIDENCE = 0.5;

let sharedMediapipeFaceDetector = null;

function convertDetections(result) {
    const detections = Array.isArray(result?.detections) ? result.detections : [];
    const faces = [];

    for (const detection of detections) {
        const box = detection?.boundingBox;
        if (!box) continue;

        const x = Number(box.originX);
        const y = Number(box.originY);
        const width = Number(box.width);
        const height = Number(box.height);

        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
            continue;
        }

        const rawScore = detection?.categories?.[0]?.score;
        const score = Number.isFinite(rawScore) ? rawScore : 0;

        faces.push({
            boundingBox: { x, y, width, height },
            score
        });
    }

    return faces;
}

/**
 * Kendi sitemizden servis edilen WASM ve TFLite modeliyle çalışan tembel MediaPipe yüz algılayıcı oluşturur.
 *
 * @param {{ loadVision?: () => Promise<{ FilesetResolver: { forVisionTasks: (basePath: string) => Promise<unknown> }, FaceDetector: { createFromOptions: (fileset: unknown, options: object) => Promise<{ detect: (imageSource: unknown) => { detections?: Array<object> }, close?: () => void }> } }>, baseUrl?: string }} [options={}] - Test ve yol yapılandırması.
 * @returns {{ detect: (imageSource: unknown) => Promise<Array<{ boundingBox: { x: number, y: number, width: number, height: number }, score: number }>>, close: () => void }} Yüz algılayıcı arayüzü.
 */
export function createMediapipeFaceDetector({
    loadVision = () => import('@mediapipe/tasks-vision'),
    baseUrl = MEDIAPIPE_SUPPORT_URL
} = {}) {
    const normalizedBaseUrl = String(baseUrl || MEDIAPIPE_SUPPORT_URL).replace(/\/+$/, '');
    const wasmBaseUrl = `${normalizedBaseUrl}/wasm`;
    const modelAssetPath = `${normalizedBaseUrl}/models/${MODEL_FILE_NAME}`;

    let detectorPromise = null;

    function getDetector() {
        if (!detectorPromise) {
            detectorPromise = (async () => {
                const vision = await loadVision();
                if (!vision?.FilesetResolver?.forVisionTasks || !vision?.FaceDetector?.createFromOptions) {
                    throw new Error('MediaPipe vision modülü eksik');
                }
                const fileset = await vision.FilesetResolver.forVisionTasks(wasmBaseUrl);
                return await vision.FaceDetector.createFromOptions(fileset, {
                    baseOptions: {
                        modelAssetPath,
                        delegate: 'CPU'
                    },
                    runningMode: 'IMAGE',
                    minDetectionConfidence: DEFAULT_MIN_DETECTION_CONFIDENCE
                });
            })().catch((error) => {
                detectorPromise = null;
                throw error;
            });
        }
        return detectorPromise;
    }

    return {
        async detect(imageSource) {
            const detector = await getDetector();
            const result = await detector.detect(imageSource);
            return convertDetections(result);
        },
        close() {
            if (!detectorPromise) return;
            const pending = detectorPromise;
            detectorPromise = null;
            pending.then((detector) => {
                if (typeof detector?.close === 'function') {
                    detector.close();
                }
            }).catch(() => {});
        }
    };
}

/**
 * Uygulama genelinde paylaşılan tekil MediaPipe yüz algılayıcı örneğini döndürür.
 *
 * @returns {{ detect: (imageSource: unknown) => Promise<Array<{ boundingBox: { x: number, y: number, width: number, height: number }, score: number }>>, close: () => void }} Paylaşılan dedektör örneği.
 */
export function getSharedMediapipeFaceDetector() {
    if (!sharedMediapipeFaceDetector) {
        sharedMediapipeFaceDetector = createMediapipeFaceDetector();
    }
    return sharedMediapipeFaceDetector;
}
