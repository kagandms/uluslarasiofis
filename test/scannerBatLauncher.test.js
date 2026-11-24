import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const BAT_PATH = new URL('../scripts/scanner/run-scanner.bat', import.meta.url);
const batContent = fs.readFileSync(BAT_PATH, 'utf8');
const batLines = batContent.split(/\r?\n/);

test('run-scanner.bat is ASCII-only', () => {
  for (let i = 0; i < batContent.length; i += 1) {
    const code = batContent.charCodeAt(i);
    assert.ok(
      code <= 0x7f,
      `Non-ASCII character at index ${i} (code ${code})`
    );
  }
});

test('run-scanner.bat has no parentheses in any echo line', () => {
  const echoLines = batLines.filter((line) => /^\s*echo(?:\s|\.)/i.test(line));
  assert.ok(echoLines.length > 0, 'Expected echo lines in batch file');

  for (const line of echoLines) {
    assert.ok(
      !line.includes('(') && !line.includes(')'),
      `Echo line must not contain parentheses: ${line}`
    );
  }
});

test('run-scanner.bat keeps production default origin and only overrides for http* args', () => {
  assert.ok(
    batContent.includes('set "SCANNER_ORIGIN=https://goc.topkapiuni.workers.dev"'),
    'Default production SCANNER_ORIGIN must be preserved'
  );

  assert.match(
    batContent,
    /if\s+(?:\/i\s+)?"![A-Za-z0-9_]+:~0,4!"=="http"\s+set\s+"SCANNER_ORIGIN=%~1"/i,
    'SCANNER_ORIGIN must only be overwritten when %~1 starts with http'
  );

  assert.doesNotMatch(
    batContent,
    /else\s*\(\s*set\s+"SCANNER_ORIGIN=%~1"/i,
    'SCANNER_ORIGIN must not be unconditionally set from %~1'
  );
});

test('run-scanner.bat forwards all arguments to runner.py and only pauses without args', () => {
  assert.ok(
    batContent.includes('runner.py %*'),
    'runner.py must receive all arguments via %*'
  );

  const runnerIndex = batLines.findIndex((line) => line.includes('runner.py %*'));
  assert.ok(runnerIndex >= 0);

  const trailingLines = batLines.slice(runnerIndex + 1).map((line) => line.trim());
  assert.ok(
    trailingLines.some((line) => /^if\s+"%~1"==""\s+pause$/i.test(line)),
    'pause must only run when no arguments were given'
  );
  assert.ok(
    !trailingLines.some((line) => /^pause$/i.test(line)),
    'Unconditional pause after runner.py must not be present'
  );
});
