// Разбор файлов тестов VTest (.dat, cp1251).
//
// Заголовок: t <минуты>, qt|q <разделов>, qq <вопросов в разделах...>,
// qqa <сколько задавать из каждого раздела...>, rp <баллы за вопрос в разделе...>.
// Вопрос начинается строкой "#..." и строкой типа:
//   A1 — текст, варианты ответа (текст или картинки)
//   A2 — текст (может быть пустым), картинка, варианты
//   A3 — текст, варианты-картинки
//   A4, A5 — картинка, варианты-картинки
//   B1 — текст, ответ вводится вручную (последняя строка)
//   B2 — картинка, ответ вводится вручную
// Первый вариант — правильный. "`E" внутри строки — перенос строки.

const IMG_RE = /\.(jpe?g|bmp|gif|png)\s*$/i;
const TYPE_RE = /^([AАBВ])\s*([1-9])\s*(.*)$/;
const HEADER_KEYS = ['t', 'qt', 'q', 'qq', 'qqa', 'rp'];

export function isImage(line) {
  return IMG_RE.test(line);
}

export function parseTest(text) {
  const lines = text.replace(/\r/g, '').split('\n');

  const header = {};
  let key = null;
  let i = 0;
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith('#')) break;
    if (HEADER_KEYS.includes(l.toLowerCase())) {
      key = l.toLowerCase();
      header[key] = [];
    } else if (key && /^-?\d+$/.test(l)) {
      header[key].push(Number(l));
    }
  }

  const blocks = [];
  let cur = null;
  for (; i < lines.length; i++) {
    const l = lines[i];
    const next = (lines[i + 1] || '').trim();
    const prevBlank = i === 0 || !lines[i - 1].trim();
    if (l.trim().startsWith('#') && (TYPE_RE.test(next) || prevBlank)) {
      cur = [];
      blocks.push(cur);
    } else if (cur) {
      cur.push(l);
    }
  }

  const questions = blocks.map(parseQuestion).filter(Boolean);
  return { minutes: (header.t || [])[0] || 0, sections: makeSections(header, questions.length), questions };
}

function parseQuestion(block) {
  let lines = block.slice();
  let type = 'A1';
  const m = (lines[0] || '').trim().match(TYPE_RE);
  if (m) {
    type = (m[1] === 'В' || m[1] === 'B' ? 'B' : 'A') + m[2];
    lines = m[3] ? [m[3], ...lines.slice(1)] : lines.slice(1);
  }

  let text = '';
  let image = null;
  let k = 0;
  const skipBlank = () => { while (k < lines.length && !lines[k].trim()) k++; };

  if (type === 'A2') {
    // строка текста (бывает пустой), затем картинка
    const first = (lines[k++] || '').trim();
    if (isImage(first)) image = first; else text = first;
    skipBlank();
    if (!image && k < lines.length && isImage(lines[k])) image = lines[k++].trim();
  } else {
    skipBlank();
    const first = (lines[k++] || '').trim();
    if (isImage(first)) image = first; else text = first;
  }

  // остальное — подряд идущие непустые строки до первой пустой
  skipBlank();
  const rest = [];
  while (k < lines.length && lines[k].trim()) rest.push(lines[k++].trim());
  if (!text && !image && !rest.length) return null;

  if (type[0] === 'B' || rest.length === 1) {
    // ввод ответа: всё кроме последней строки — продолжение вопроса
    const answer = rest.pop() || '';
    if (rest.length) text = [text, ...rest].filter(Boolean).join('`E');
    return { type, text: unescape(text), image, input: true, answer };
  }
  return { type, text: unescape(text), image, input: false, options: rest.map(unescape) };
}

function unescape(s) {
  return s.replace(/`E/g, '\n');
}

function makeSections(h, total) {
  const qq = h.qq || [];
  const qqa = h.qqa || [];
  const rp = h.rp || [];
  const sum = qq.reduce((a, b) => a + b, 0);
  if (!qq.length || sum !== total || qqa.length < qq.length) {
    // заголовок не сходится с содержимым — один раздел на все вопросы
    const ask = qqa.reduce((a, b) => a + b, 0) || total;
    return [{ from: 0, count: total, ask: Math.min(ask, total), points: rp[0] || 0 }];
  }
  let from = 0;
  return qq.map((count, s) => {
    const sec = { from, count, ask: Math.min(qqa[s] || 0, count), points: rp[s] ?? rp[rp.length - 1] ?? 0 };
    from += count;
    return sec;
  });
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Набор вопросов для одной попытки: из каждого раздела случайные qqa штук,
// порядок вопросов и вариантов ответа каждый раз новый.
export function makeAttempt(test) {
  const items = [];
  for (const sec of test.sections) {
    const idx = shuffle([...Array(sec.count).keys()].map((n) => sec.from + n)).slice(0, sec.ask);
    for (const qi of idx) {
      const q = test.questions[qi];
      items.push({
        q,
        points: sec.points,
        order: q.input ? null : shuffle(q.options.map((_, n) => n)),
        answer: null,
      });
    }
  }
  return shuffle(items);
}

function normalize(s) {
  return String(s).trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').replace(/[.;]+$/, '');
}

function asNumber(s) {
  const t = normalize(s).replace(/\s/g, '').replace(',', '.');
  return /^[+-]?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

export function isCorrect(item) {
  if (item.answer === null || item.answer === '') return false;
  if (!item.q.input) return item.answer === 0;
  const a = asNumber(item.answer);
  const b = asNumber(item.q.answer);
  if (a !== null && b !== null) return Math.abs(a - b) < 1e-9;
  return normalize(item.answer) === normalize(item.q.answer);
}

// Если в тесте заданы баллы (rp) — результат это сумма баллов,
// иначе процент правильных ответов.
export function score(items) {
  const correct = items.filter(isCorrect);
  const weighted = items.some((it) => it.points > 0);
  const value = weighted
    ? correct.reduce((s, it) => s + it.points, 0)
    : Math.round((100 * correct.length) / (items.length || 1));
  const max = weighted ? items.reduce((s, it) => s + it.points, 0) : 100;
  return { value, max, correct: correct.length, total: items.length };
}

// Путь к картинке на сервере: как в оригинале относительно папки Test,
// регистр не важен, BMP заранее перегнаны в PNG.
export function imageUrl(path) {
  const p = path.trim().replace(/\\/g, '/').toLowerCase().replace(/\.bmp$/, '.png');
  return 'data/tests/' + p.split('/').map(encodeURIComponent).join('/');
}
