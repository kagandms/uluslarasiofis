import { join, resolve } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { PDFJS_VERSION } from './src/config/pdfjs-version.js';
import { MEDIAPIPE_SUPPORT_URL } from './src/config/mediapipe-version.js';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const pdfjsDistributionRoot = resolve(projectRoot, 'node_modules/pdfjs-dist');
const pdfjsSupportUrl = `/pdfjs-support/${PDFJS_VERSION}`;
const pdfjsSupportDirectories = ['cmaps', 'standard_fonts'];
const mediapipeWasmRoot = resolve(projectRoot, 'node_modules/@mediapipe/tasks-vision/wasm');
const mediapipeModelsRoot = resolve(projectRoot, 'vendor/mediapipe');
const mediapipeSupportAssets = [
    {
        directoryName: 'wasm',
        fileName: 'vision_wasm_internal.js',
        sourceDirectory: mediapipeWasmRoot,
        contentType: 'text/javascript'
    },
    {
        directoryName: 'wasm',
        fileName: 'vision_wasm_internal.wasm',
        sourceDirectory: mediapipeWasmRoot,
        contentType: 'application/wasm'
    },
    {
        directoryName: 'models',
        fileName: 'blaze_face_short_range.tflite',
        sourceDirectory: mediapipeModelsRoot,
        contentType: 'application/octet-stream'
    }
];

function servePdfjsSupportAsset(request, response, next) {
    const requestPath = request.url?.split('?')[0] || '';
    if (!requestPath.startsWith(`${pdfjsSupportUrl}/`)) return next();

    const [directoryName, fileName, ...extraSegments] = requestPath.slice(pdfjsSupportUrl.length + 1).split('/');
    if (extraSegments.length || !pdfjsSupportDirectories.includes(directoryName) || !fileName) {
        response.statusCode = 404;
        response.end();
        return;
    }

    const directoryPath = resolve(pdfjsDistributionRoot, directoryName);
    const assetPath = resolve(directoryPath, fileName);
    if (!assetPath.startsWith(`${directoryPath}/`) || !statSync(assetPath, { throwIfNoEntry: false })?.isFile()) {
        response.statusCode = 404;
        response.end();
        return;
    }

    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.end(readFileSync(assetPath));
}

function pdfjsSupportAssetsPlugin() {
    return {
        name: 'pdfjs-support-assets',
        configureServer(server) {
            server.middlewares.use(servePdfjsSupportAsset);
        },
        generateBundle() {
            for (const directoryName of pdfjsSupportDirectories) {
                const sourceDirectory = join(pdfjsDistributionRoot, directoryName);
                for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
                    if (!entry.isFile()) continue;
                    this.emitFile({
                        type: 'asset',
                        fileName: `${pdfjsSupportUrl.slice(1)}/${directoryName}/${entry.name}`,
                        source: readFileSync(join(sourceDirectory, entry.name))
                    });
                }
            }
        }
    };
}

function serveMediapipeSupportAsset(request, response, next) {
    const requestPath = request.url?.split('?')[0] || '';
    if (!requestPath.startsWith(`${MEDIAPIPE_SUPPORT_URL}/`)) return next();

    const [directoryName, fileName, ...extraSegments] = requestPath.slice(MEDIAPIPE_SUPPORT_URL.length + 1).split('/');
    const asset = !extraSegments.length
        ? mediapipeSupportAssets.find((item) => item.directoryName === directoryName && item.fileName === fileName)
        : null;
    if (!asset) {
        response.statusCode = 404;
        response.end();
        return;
    }

    const assetPath = resolve(asset.sourceDirectory, asset.fileName);
    if (!assetPath.startsWith(`${asset.sourceDirectory}/`) || !statSync(assetPath, { throwIfNoEntry: false })?.isFile()) {
        response.statusCode = 404;
        response.end();
        return;
    }

    response.setHeader('Content-Type', asset.contentType);
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.end(readFileSync(assetPath));
}

function mediapipeSupportAssetsPlugin() {
    return {
        name: 'mediapipe-support-assets',
        configureServer(server) {
            server.middlewares.use(serveMediapipeSupportAsset);
        },
        generateBundle() {
            for (const asset of mediapipeSupportAssets) {
                this.emitFile({
                    type: 'asset',
                    fileName: `${MEDIAPIPE_SUPPORT_URL.slice(1)}/${asset.directoryName}/${asset.fileName}`,
                    source: readFileSync(join(asset.sourceDirectory, asset.fileName))
                });
            }
        }
    };
}

export default defineConfig({
    // Yalnızca yerel geliştirme içindir; üretim derlemelerinde bu değişken ayarlanmaz.
    define: { 'import.meta.env.PHYSICAL_INTAKES_ENABLED': JSON.stringify(['staging', 'production'].includes(process.env.CLOUDFLARE_ENV) || process.env.PHYSICAL_INTAKES_ENABLED === 'true') },
    plugins: [cloudflare(), pdfjsSupportAssetsPlugin(), mediapipeSupportAssetsPlugin()],
    environments: {
        client: {
            build: {
                rollupOptions: {
                    input: {
                        portal: resolve(projectRoot, 'index.html'),
                        application: resolve(projectRoot, 'basvuru/index.html'),
                        tracking: resolve(projectRoot, 'basvurum/index.html'),
                        resume: resolve(projectRoot, 'basvuruya-devam-et/index.html'),
                        print: resolve(projectRoot, 'yazdir/index.html'),
                        staff: resolve(projectRoot, 'yetkili/index.html'),
                        mobileTransfer: resolve(projectRoot, 'mobile-transfer/index.html')
                    }
                }
            }
        }
    }
});
