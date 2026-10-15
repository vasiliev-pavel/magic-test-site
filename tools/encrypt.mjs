// Шифрует тесты паролем для сайта.
//
//   node tools/encrypt.mjs <пароль> [папка с .dat]   (по умолчанию tests-src)
//
// Все .dat (Windows-1251) из папки попадают в public/data/tests.enc.
// Исходники тестов в git не попадают (tests-src в .gitignore).
import fs from 'node:fs';
import path from 'node:path';
import { encrypt, decrypt } from '../public/crypto.js';

const [password, dir = 'tests-src'] = process.argv.slice(2);
if (!password) {
  console.error('Использование: node tools/encrypt.mjs <пароль> [папка с .dat]');
  process.exit(1);
}

const tests = {};
for (const file of fs.readdirSync(dir).sort()) {
  if (path.extname(file).toLowerCase() !== '.dat') continue;
  const name = path.basename(file, path.extname(file));
  tests[name] = new TextDecoder('windows-1251').decode(fs.readFileSync(path.join(dir, file)));
}
if (!Object.keys(tests).length) {
  console.error(`В папке ${dir} нет .dat файлов`);
  process.exit(1);
}

const plain = JSON.stringify({ tests });
const box = await encrypt(password, plain);
if ((await decrypt(password, box)) !== plain) throw new Error('Проверка расшифровки не прошла');

const out = path.join('public', 'data', 'tests.enc');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(box));
console.log(`Зашифровано тестов: ${Object.keys(tests).length} → ${out}`);
