(() => {
  'use strict';

  const MODES = {
    focus: { minutes: 25, label: '¡Hora de enfocarse!', doneMsg: '¡Pomodoro completado! Toma un descanso.' },
    short: { minutes: 5,  label: 'Respira y estira',    doneMsg: 'Descanso terminado. ¡A enfocarse!' },
    long:  { minutes: 15, label: 'Descanso largo, te lo ganaste', doneMsg: 'Descanso largo terminado. ¡A enfocarse!' },
  };
  const CYCLES_BEFORE_LONG = 4;
  const CIRC = 2 * Math.PI * 90;

  const $ = (id) => document.getElementById(id);
  const el = {
    time: $('time'), label: $('label'), progress: $('progress'), dial: $('dial'),
    start: $('startBtn'), reset: $('resetBtn'), skip: $('skipBtn'),
    cycle: $('cycle'), currentTask: $('currentTask'), notif: $('notifBtn'), sound: $('soundToggle'),
    taskForm: $('taskForm'), taskInput: $('taskInput'), taskList: $('taskList'), clearDone: $('clearDone'),
    bars: $('bars'),
  };

  // ---------- Persistencia segura ----------
  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  };

  // ---------- Estado ----------
  let mode = 'focus';
  let totalMs = MODES.focus.minutes * 60000;
  let remainingMs = totalMs;
  let endAt = null;          // timestamp de fin cuando corre
  let tickId = null;
  let completedInCycle = 0;  // pomodoros en el ciclo actual (0..4)
  let tasks = store.get('pomo.tasks', []);
  let activeTaskId = store.get('pomo.activeTask', null);
  let stats = store.get('pomo.stats', {}); // { 'YYYY-MM-DD': n }
  el.sound.checked = store.get('pomo.sound', true);

  const dayKey = (d = new Date()) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const fmt = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const running = () => endAt !== null;

  // ---------- Render del timer ----------
  function renderTimer() {
    const left = running() ? Math.max(0, endAt - Date.now()) : remainingMs;
    const text = fmt(left);
    el.time.textContent = text;
    el.progress.style.strokeDasharray = CIRC;
    el.progress.style.strokeDashoffset = CIRC * (1 - left / totalMs);
    document.title = running() ? `${text} · ${modeName()} 🍅` : 'Pomodoro 🍅';
  }
  const modeName = () => ({ focus: 'Enfoque', short: 'Descanso', long: 'Descanso largo' }[mode]);

  function renderCycle() {
    el.cycle.innerHTML = '';
    for (let i = 0; i < CYCLES_BEFORE_LONG; i++) {
      const s = document.createElement('span');
      if (i < completedInCycle) s.className = 'done';
      el.cycle.appendChild(s);
    }
  }

  function renderUI() {
    document.body.dataset.mode = mode;
    document.querySelectorAll('.tabs button').forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    });
    el.label.textContent = MODES[mode].label;
    el.start.textContent = running() ? 'Pausar' : (remainingMs < totalMs ? 'Continuar' : 'Iniciar');
    el.dial.classList.toggle('running', running());
    const t = tasks.find((x) => x.id === activeTaskId);
    el.currentTask.textContent = t && mode === 'focus' ? `Trabajando en: ${t.text}` : '';
    renderCycle();
    renderTimer();
  }

  // ---------- Control del timer ----------
  function setMode(m, autoStart = false) {
    stop();
    mode = m;
    totalMs = remainingMs = MODES[m].minutes * 60000;
    renderUI();
    if (autoStart) start();
  }

  function start() {
    if (running()) return;
    unlockAudio();
    endAt = Date.now() + remainingMs;
    tickId = setInterval(tick, 250);
    renderUI();
  }

  function pause() {
    if (!running()) return;
    remainingMs = Math.max(0, endAt - Date.now());
    stop();
    renderUI();
  }

  function stop() {
    clearInterval(tickId);
    tickId = null;
    endAt = null;
  }

  function tick() {
    if (endAt - Date.now() <= 0) return complete();
    renderTimer();
  }

  function complete() {
    const finished = mode;
    stop();
    remainingMs = 0;
    if (finished === 'focus') {
      recordPomodoro();
      completedInCycle++;
    }
    notify(MODES[finished].doneMsg);
    beep();
    let next;
    if (finished === 'focus') {
      if (completedInCycle >= CYCLES_BEFORE_LONG) { next = 'long'; completedInCycle = 0; }
      else next = 'short';
    } else {
      next = 'focus';
    }
    setMode(next); // el siguiente modo espera a que el usuario pulse Iniciar
  }

  // ---------- Estadísticas ----------
  function recordPomodoro() {
    const k = dayKey();
    stats[k] = (stats[k] || 0) + 1;
    store.set('pomo.stats', stats);
    const t = tasks.find((x) => x.id === activeTaskId);
    if (t) { t.pomodoros = (t.pomodoros || 0) + 1; saveTasks(); renderTasks(); }
    renderStats();
  }

  function renderStats() {
    const today = stats[dayKey()] || 0;
    let week = 0;
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const n = stats[dayKey(d)] || 0;
      week += n;
      days.push({ n, label: d.toLocaleDateString('es', { weekday: 'short' }).slice(0, 3) });
    }
    const total = Object.values(stats).reduce((a, b) => a + b, 0);
    $('statToday').textContent = today;
    $('statWeek').textContent = week;
    $('statTotal').textContent = total;
    $('statMinutes').textContent = today * MODES.focus.minutes;
    const max = Math.max(1, ...days.map((d) => d.n));
    el.bars.innerHTML = days.map((d) =>
      `<div class="bar ${d.n ? '' : 'zero'}" title="${d.n} pomodoros"><span>${d.n || ''}</span><i style="height:${(d.n / max) * 70}%"></i><span>${d.label}</span></div>`
    ).join('');
  }

  // ---------- Tareas ----------
  const saveTasks = () => { store.set('pomo.tasks', tasks); store.set('pomo.activeTask', activeTaskId); };

  function renderTasks() {
    el.taskList.innerHTML = '';
    if (!tasks.length) {
      el.taskList.innerHTML = '<li class="empty">Aún no hay tareas. ¡Añade la primera!</li>';
      return;
    }
    tasks.forEach((t) => {
      const li = document.createElement('li');
      li.className = (t.done ? 'done ' : '') + (t.id === activeTaskId ? 'active' : '');

      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = t.done; cb.setAttribute('aria-label', 'Completada');
      cb.addEventListener('change', () => {
        t.done = cb.checked;
        if (t.done && activeTaskId === t.id) activeTaskId = null;
        saveTasks(); renderTasks(); renderUI();
      });

      const name = document.createElement('span');
      name.className = 'name'; name.textContent = t.text; name.title = 'Clic para trabajar en esta tarea';
      name.addEventListener('click', () => {
        if (t.done) return;
        activeTaskId = activeTaskId === t.id ? null : t.id;
        saveTasks(); renderTasks(); renderUI();
      });

      const count = document.createElement('span');
      count.className = 'count'; count.textContent = t.pomodoros ? `🍅 ${t.pomodoros}` : '';

      const del = document.createElement('button');
      del.className = 'del'; del.textContent = '✕'; del.setAttribute('aria-label', 'Eliminar tarea');
      del.addEventListener('click', () => {
        tasks = tasks.filter((x) => x.id !== t.id);
        if (activeTaskId === t.id) activeTaskId = null;
        saveTasks(); renderTasks(); renderUI();
      });

      li.append(cb, name, count, del);
      el.taskList.appendChild(li);
    });
  }

  el.taskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = el.taskInput.value.trim();
    if (!text) return;
    const t = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, done: false, pomodoros: 0 };
    tasks.push(t);
    if (!activeTaskId) activeTaskId = t.id;
    el.taskInput.value = '';
    saveTasks(); renderTasks(); renderUI();
  });

  el.clearDone.addEventListener('click', () => {
    tasks = tasks.filter((t) => !t.done);
    saveTasks(); renderTasks();
  });

  // ---------- Sonido ----------
  let audioCtx = null;
  function unlockAudio() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch { /* sin audio */ }
  }
  function beep() {
    if (!el.sound.checked) return;
    unlockAudio();
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    [880, 1100, 880, 1320].forEach((freq, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      const t0 = now + i * 0.25;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0); o.stop(t0 + 0.24);
    });
  }
  el.sound.addEventListener('change', () => store.set('pomo.sound', el.sound.checked));

  // ---------- Notificaciones ----------
  function updateNotifBtn() {
    if (!('Notification' in window)) { el.notif.hidden = true; return; }
    const p = Notification.permission;
    el.notif.textContent = p === 'granted' ? '🔔 Avisos activados' : p === 'denied' ? '🔕 Avisos bloqueados' : '🔔 Activar avisos';
    el.notif.disabled = p !== 'default';
  }
  function notify(msg) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification('Pomodoro 🍅', { body: msg }); } catch { /* algunos móviles no lo permiten */ }
    }
  }
  el.notif.addEventListener('click', async () => {
    try { await Notification.requestPermission(); } catch { /* ignorar */ }
    updateNotifBtn();
  });

  // ---------- Eventos ----------
  el.start.addEventListener('click', () => (running() ? pause() : start()));
  el.reset.addEventListener('click', () => setMode(mode));
  el.skip.addEventListener('click', () => {
    const next = mode === 'focus' ? (completedInCycle + 1 >= CYCLES_BEFORE_LONG ? 'long' : 'short') : 'focus';
    // Saltar un enfoque no cuenta como pomodoro completado
    if (mode === 'focus' && next === 'long') completedInCycle = 0;
    setMode(next);
  });
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'button' || tag === 'textarea') return;
    e.preventDefault();
    running() ? pause() : start();
  });

  // Al volver a la pestaña, recalcula de inmediato (los navegadores frenan los timers en segundo plano)
  document.addEventListener('visibilitychange', () => { if (running()) tick(); });

  // ---------- Inicio ----------
  renderTasks();
  renderStats();
  updateNotifBtn();
  renderUI();
})();
