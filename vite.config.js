import { join, resolve } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { PDFJS_VERSION } from './src/config/pdfjs-version.js';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const pdfjsDistributionRoot = resolve(projectRoot, 'node_modules/pdfjs-dist');
const pdfjsSupportUrl = `/pdfjs-support/${PDFJS_VERSION}`;
const pdfjsSupportDirectories = ['cmaps', 'standard_fonts'];

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

export default defineConfig({
    define: { 'import.meta.env.PHYSICAL_INTAKES_ENABLED': JSON.stringify(['staging', 'production'].includes(process.env.CLOUDFLARE_ENV)) },
    plugins: [cloudflare(), pdfjsSupportAssetsPlugin()],
    environments: {
        client: {
            build: {
                rollupOptions: {
                    input: {
                        portal: resolve(projectRoot, 'index.html'),
                        application: resolve(projectRoot, 'basvuru/index.html'),
                        tracking: resolve(projectRoot, 'basvurum/index.html'),
                        print: resolve(projectRoot, 'yazdir/index.html'),
                        staff: resolve(projectRoot, 'yetkili/index.html'),
                        mobileTransfer: resolve(projectRoot, 'mobile-transfer/index.html')
                    }
                }
            }
        }
    }
});
