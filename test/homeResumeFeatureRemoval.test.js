import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const readProjectFile = (path) => readFileSync(new URL(path, `file://${projectRoot}/`), 'utf8');

test('continuation form is moved off the homepage to its own page and linked from tracking', () => {
    const homepage = readProjectFile('index.html');
    const tracking = readProjectFile('src/public/applicationTracking.js');
    const resumePage = readProjectFile('basvuruya-devam-et/index.html');
    const publicMain = readProjectFile('src/public/main.js');

    assert.doesNotMatch(homepage, /btn-home-resume|application-resume-card|resume-application-form/u);
    assert.match(tracking, /\/basvuruya-devam-et\//u);
    assert.match(resumePage, /data-page="resume"/u);
    assert.match(resumePage, /id="resume-application-form"/u);
    assert.match(publicMain, /page === 'resume'/u);
    assert.equal(existsSync(new URL('../src/public/homeResumeForm.js', import.meta.url)), true);
});
