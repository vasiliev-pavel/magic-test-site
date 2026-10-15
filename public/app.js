import { parseTest, makeAttempt, score, imageUrl, isImage, isCorrect } from './vtest.js';
import { decrypt } from './crypto.js';

const $ = (id) => document.getElementById(id);
const JOURNAL_KEY = 'vtest-journal';
const ATTEMPT_KEY = 'vtest-attempt';
const NAME_KEY = 'vtest-name';
const PASSWORD_KEY = 'vtest-password'; // sessionStorage: до закрытия вкладки

let tests = {}; // название → текст .dat, расшифровывается паролем
let attempt = null; // { test, student, mode, items, pos, deadline }
let timerId = null;

function store(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function show(id) {
  for (const s of ['lock', 'start', 'quiz', 'result', 'journal']) $(s).hidden = s !== id;
  $('timer').hidden = id !== 'quiz';
  if (id !== 'quiz') $('who').textContent = '';
}

function startError(text) {
  $('start-error').textContent = text || '';
  $('start-error').hidden = !text;
}

async function fetchTest(name) {
  if (!(name in tests)) throw new Error('Тест не найден');
  return parseTest(tests[name]);
}

// Режимы: train — ответ проверяется сразу, exam — результат только в конце
const isExam = () => attempt.mode === 'exam';
const answered = (it) => it.answer !== null && it.answer !== '';

// ---------- Пароль ----------

async function unlock(password) {
  const res = await fetch('data/tests.enc', { cache: 'no-cache' });
  if (!res.ok) throw new Error('Не удалось загрузить тест');
  const box = await res.json();
  try {
    tests = JSON.parse(await decrypt(password, box)).tests;
  } catch {
    throw new Error('Неверный пароль');
  }
  try { sessionStorage.setItem(PASSWORD_KEY, password); } catch {}
}

function openLock(error) {
  show('lock');
  $('lock-error').textContent = error || '';
  $('lock-error').hidden = !error;
  $('password').focus();
}

async function submitPassword() {
  $('unlock').disabled = true;
  try {
    await unlock($('password').value);
    $('password').value = '';
    afterUnlock();
  } catch (e) {
    openLock(e.message);
  } finally {
    $('unlock').disabled = false;
  }
}

// ---------- Выбор теста ----------

// Список тестов показывается, только если их больше одного
function fillTests() {
  const names = Object.keys(tests);
  $('test').replaceChildren(...names.map((t) => new Option(t, t)));
  $('test-row').hidden = names.length < 2;
  $('title').textContent = names.length === 1 ? names[0] : 'Тестирование';
  showTestInfo();
}

async function showTestInfo() {
  const name = $('test').value;
  $('test-info').textContent = '';
  if (!name) return;
  try {
    const t = await fetchTest(name);
    if ($('test').value !== name) return;
    const ask = t.sections.reduce((s, x) => s + x.ask, 0);
    $('test-info').textContent = `Вопросов: ${ask}` + (t.minutes ? `, время: ${t.minutes} мин.` : '');
  } catch (e) {
    $('test-info').textContent = e.message;
  }
}

function openStart() {
  show('start');
  startError();
}

async function begin() {
  const test = $('test').value;
  const student = $('name').value.trim().replace(/\s+/g, ' ');
  const mode = document.querySelector('input[name="mode"]:checked').value;
  if (!test) return startError('Выберите тест');
  if (!student) return startError('Введите фамилию и имя');
  startError();
  store(NAME_KEY, student);

  $('begin').disabled = true;
  try {
    const t = await fetchTest(test);
    const items = makeAttempt(t);
    if (!items.length) return startError('В тесте нет вопросов');
    attempt = {
      test, student, mode, items, pos: 0,
      deadline: t.minutes ? Date.now() + t.minutes * 60000 : null,
    };
    startQuiz();
  } catch (e) {
    startError(e.message);
  } finally {
    $('begin').disabled = false;
  }
}

// ---------- Прохождение ----------

function startQuiz() {
  show('quiz');
  $('who').textContent = `${attempt.test} · ${attempt.student}`;
  clearInterval(timerId);
  if (attempt.deadline) {
    tick();
    timerId = setInterval(tick, 1000);
  } else {
    $('timer').hidden = true;
  }
  render();
}

function tick() {
  const left = Math.max(0, attempt.deadline - Date.now());
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  $('timer').textContent = `${m}:${String(s).padStart(2, '0')}`;
  $('timer').classList.toggle('low', left < 60000);
  if (!left) finish();
}

function media(path) {
  const img = document.createElement('img');
  img.src = imageUrl(path);
  img.alt = '';
  img.onerror = () => {
    const span = document.createElement('span');
    span.className = 'missing';
    span.textContent = `[нет изображения ${path}]`;
    img.replaceWith(span);
  };
  return img;
}

// С ответами: ответ проверяется сразу и больше не меняется.
// Без ответов: ответ можно менять до конца теста.
function answer(item, value) {
  if (item.checked) return;
  item.answer = value;
  item.checked = !isExam();
  save();
  render();
}

function render() {
  const { items, pos } = attempt;
  const item = items[pos];
  const q = item.q;
  const ok = item.checked && isCorrect(item);

  $('bar').style.width = `${(100 * items.filter(answered).length) / items.length}%`;
  $('counter').textContent = `Вопрос ${pos + 1} из ${items.length}`;
  $('finish-confirm').hidden = true;

  const qEl = $('question');
  qEl.replaceChildren();
  if (q.text) qEl.append(q.text);
  if (q.image) qEl.append(media(q.image));

  const aEl = $('answers');
  aEl.replaceChildren();
  const fb = $('feedback');
  fb.hidden = !item.checked;
  fb.className = 'feedback ' + (ok ? 'right' : 'wrong');

  if (q.input) {
    const row = document.createElement('div');
    row.className = 'answer-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Введите ответ';
    input.value = item.answer ?? '';
    input.disabled = !!item.checked;
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = isExam() ? (answered(item) ? 'Изменить' : 'Сохранить') : 'Ответить';
    btn.hidden = !!item.checked;
    const submit = () => { if (input.value.trim()) answer(item, input.value.trim()); };
    btn.onclick = submit;
    input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
    row.append(input, btn);
    aEl.append(row);
    if (item.checked) {
      input.classList.add(ok ? 'right' : 'wrong');
      fb.textContent = ok ? 'Верно' : `Неверно. Правильный ответ: ${q.answer}`;
    } else {
      input.focus();
    }
  } else {
    for (const n of item.order) {
      const label = document.createElement('label');
      label.className = 'option';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'answer';
      radio.checked = item.answer === n;
      radio.disabled = !!item.checked;
      radio.onchange = () => answer(item, n);
      if (item.checked) {
        label.classList.add('locked');
        if (n === 0) label.classList.add('right');
        else if (item.answer === n) label.classList.add('wrong');
      }
      const opt = q.options[n];
      label.append(radio, isImage(opt) ? media(opt) : opt);
      aEl.append(label);
    }
    fb.textContent = ok ? 'Верно' : 'Неверно — правильный ответ выделен зелёным';
  }

  $('prev').disabled = pos === 0;
  $('next').hidden = pos === items.length - 1;
  renderDots();
  save();
}

function renderDots() {
  $('dots').replaceChildren(...attempt.items.map((it, n) => {
    const b = document.createElement('button');
    b.textContent = n + 1;
    if (it.checked) b.classList.add(isCorrect(it) ? 'right' : 'wrong');
    else if (answered(it)) b.classList.add('done');
    if (n === attempt.pos) b.classList.add('cur');
    b.onclick = () => { attempt.pos = n; render(); };
    return b;
  }));
}

function go(delta) {
  const pos = attempt.pos + delta;
  if (pos < 0 || pos >= attempt.items.length) return;
  attempt.pos = pos;
  render();
}

function save() {
  store(ATTEMPT_KEY, attempt);
}

function askFinish() {
  const left = attempt.items.filter((i) => !answered(i)).length;
  $('finish-text').textContent = left ? `Без ответа: ${left}. Завершить тест?` : 'Завершить тест?';
  $('finish-confirm').hidden = false;
  $('finish-yes').focus();
}

function finish() {
  if (!attempt) return;
  clearInterval(timerId);
  const res = score(attempt.items);
  const journal = load(JOURNAL_KEY, []);
  journal.push({
    date: new Date().toISOString(),
    test: attempt.test + (isExam() ? ' (без ответов)' : ' (с ответами)'),
    student: attempt.student,
    score: res.value,
    correct: res.correct,
    total: res.total,
  });
  store(JOURNAL_KEY, journal);
  store(ATTEMPT_KEY, undefined);

  $('score').textContent = res.max === 100 ? `${res.value}` : `${res.value} из ${res.max}`;
  $('score-info').textContent =
    `${attempt.student}\n${attempt.test}\nПравильных ответов: ${res.correct} из ${res.total}`;
  attempt = null;
  show('result');
}

// ---------- Журнал ----------

function openJournal() {
  show('journal');
  $('clear').textContent = 'Очистить';
  const rows = load(JOURNAL_KEY, []).slice().reverse();
  $('journal-rows').replaceChildren(...rows.map((r) => {
    const tr = document.createElement('tr');
    for (const v of [new Date(r.date).toLocaleString('ru-RU'), r.test, r.student, r.score]) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.append(td);
    }
    return tr;
  }));
}

function exportJournal() {
  // Как в оригинале (Result/*.xls): таблица через табуляцию, Excel открывает её сам
  const rows = load(JOURNAL_KEY, []);
  const lines = [['Дата', 'Тест', 'Студент', 'Результат', 'Правильных', 'Вопросов'],
    ...rows.map((r) => [new Date(r.date).toLocaleString('ru-RU'), r.test, r.student, r.score, r.correct, r.total])];
  const text = '﻿' + lines.map((l) => l.join('\t')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/vnd.ms-excel;charset=utf-8' }));
  a.download = 'Результаты.xls';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- Запуск ----------

function route() {
  if (attempt) return; // во время теста навигация не сбрасывает попытку
  if (!Object.keys(tests).length) return openLock();
  if (location.hash === '#journal') openJournal();
  else openStart();
}

async function init() {
  $('unlock').onclick = submitPassword;
  $('password').onkeydown = (e) => { if (e.key === 'Enter') submitPassword(); };
  $('test').onchange = showTestInfo;
  $('begin').onclick = begin;
  $('name').onkeydown = (e) => { if (e.key === 'Enter') begin(); };
  $('prev').onclick = () => go(-1);
  $('next').onclick = () => go(1);
  $('finish').onclick = askFinish;
  $('finish-yes').onclick = finish;
  $('finish-no').onclick = () => { $('finish-confirm').hidden = true; };
  $('again').onclick = () => { location.hash = ''; openStart(); };
  $('export').onclick = exportJournal;
  $('clear').onclick = () => {
    // второе нажатие подтверждает удаление
    if ($('clear').textContent === 'Очистить') {
      $('clear').textContent = 'Точно удалить все результаты?';
      return;
    }
    store(JOURNAL_KEY, []);
    openJournal();
  };
  window.addEventListener('hashchange', route);

  let saved = null;
  try { saved = sessionStorage.getItem(PASSWORD_KEY); } catch {}
  if (saved !== null) {
    try { await unlock(saved); } catch { return openLock(); }
    return afterUnlock();
  }
  openLock();
}

function afterUnlock() {
  $('name').value = load(NAME_KEY, '');
  fillTests();

  // Незавершённая попытка (например, страницу перезагрузили)
  const saved = load(ATTEMPT_KEY, null);
  if (saved && saved.items?.length && saved.test in tests) {
    attempt = saved;
    if (attempt.deadline && attempt.deadline <= Date.now()) finish();
    else startQuiz();
    return;
  }
  route();
}

init().catch((e) => {
  document.querySelector('main').textContent = 'Ошибка загрузки: ' + e.message;
});
