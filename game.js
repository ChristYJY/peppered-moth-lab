(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const random = (min, max) => Math.random() * (max - min) + min;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const CAPTURE_GOAL = 10;
  const MOTHS_PER_TYPE = 60;
  const TIME_LIMIT_MS = 120000;
  const MAX_CAPTURE_DISTANCE = 15;
  const shuffle = (items) => {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };

  const els = {
    start: $('#startScreen'),
    game: $('#gameScreen'),
    viewport: $('#sceneViewport'),
    canvas: $('#forestCanvas'),
    timer: $('#timer'),
    captureCount: $('#captureCount'),
    environment: $('#environmentLabel'),
    reticle: $('.reticle'),
    feedback: $('#captureFeedback'),
    refresh: $('#sceneRefresh'),
    refreshNumber: $('#refreshNumber'),
    ready: $('#readyOverlay'),
    readyText: $('#readyText'),
    readyActions: $('#readyActions'),
    result: $('#resultPanel'),
    resultEnvironment: $('#resultEnvironment'),
    lightCaptured: $('#lightCaptured'),
    darkCaptured: $('#darkCaptured'),
    status: $('#liveStatus'),
    joystick: $('#joystick'),
    knob: $('#joystickKnob'),
    captureButton: $('#captureButton'),
    soundButton: $('#soundButton')
  };

  let renderer;
  const state = {
    theme: 'pale',
    moths: [],
    captured: { light: 0, dark: 0 },
    totalCaptured: 0,
    running: false,
    transitioning: false,
    sound: true,
    deadline: 0,
    timerId: 0,
    drag: null,
    joy: { x: 0, y: 0, pointerId: null },
    joyFiltered: { x: 0, y: 0 },
    transitionTimers: [],
    keys: new Set(),
    audio: null,
    roundId: 0,
    lastControlFrame: performance.now()
  };

  const themeLabel = () => state.theme === 'pale' ? '浅色树干' : '深色树干';

  function createPopulation() {
    state.moths = [];
    for (let i = 0; i < MOTHS_PER_TYPE; i += 1) state.moths.push({ id: 'light-' + i, type: 'light', alive: true });
    for (let i = 0; i < MOTHS_PER_TYPE; i += 1) state.moths.push({ id: 'dark-' + i, type: 'dark', alive: true });
  }

  async function countdown(roundId) {
    els.ready.classList.remove('is-hidden');
    els.ready.classList.add('is-loading');
    els.ready.classList.remove('is-error');
    els.readyActions.classList.add('is-hidden');
    els.readyText.textContent = '正在载入桦尺蛾素材';
    if (!await renderer.whenMothsReady()) {
      if (roundId !== state.roundId) return;
      els.ready.classList.remove('is-loading');
      els.ready.classList.add('is-error');
      els.readyActions.classList.remove('is-hidden');
      els.readyText.textContent = renderer.supported ? '素材加载超时，请重试' : '当前浏览器不支持三维场景';
      els.status.textContent = els.readyText.textContent;
      return;
    }
    if (roundId !== state.roundId) return;
    els.ready.classList.remove('is-loading');
    for (const value of ['3', '2', '1', '开始']) {
      if (roundId !== state.roundId) return;
      els.readyText.textContent = value;
      await new Promise((resolve) => setTimeout(resolve, value === '开始' ? 450 : 520));
    }
    if (roundId !== state.roundId) return;
    els.ready.classList.add('is-hidden');
    state.running = true;
    state.deadline = performance.now() + TIME_LIMIT_MS;
    state.timerId = window.setInterval(updateTimer, 100);
    els.status.textContent = '实验开始，剩余时间 2 分钟。';
  }

  function startGame(theme = state.theme) {
    // Keep large 3D textures off the network until a scene is actually selected.
    if (!renderer) renderer = new ForestScene(els.canvas);
    if (renderer.setActive) renderer.setActive(true);
    state.transitionTimers.forEach(clearTimeout);
    state.transitionTimers = [];
    releaseJoystick();
    state.drag = null;
    clearInterval(state.timerId);
    state.keys.clear();
    state.theme = theme;
    state.captured = { light: 0, dark: 0 };
    state.totalCaptured = 0;
    state.running = false;
    state.transitioning = false;
    createPopulation();
    els.captureCount.textContent = '0';
    els.timer.textContent = '02:00';
    els.feedback.textContent = '';
    els.feedback.classList.remove('show');
    els.timer.parentElement.classList.remove('urgent');
    els.environment.textContent = themeLabel();
    els.result.classList.add('is-hidden');
    els.start.classList.add('is-hidden');
    els.game.classList.remove('is-hidden', 'theme-pale', 'theme-dark');
    els.game.classList.add('theme-' + state.theme);
    renderer.randomizeScene(state.theme, state.moths);
    if (!renderer.supported) {
      els.status.textContent = '当前浏览器未启用 WebGL，建议使用最新版 Chrome 或 Edge。';
    }
    const roundId = ++state.roundId;
    countdown(roundId);
  }

  function updateTimer() {
    if (!state.running || state.transitioning) return;
    const remaining = Math.max(0, state.deadline - performance.now());
    const seconds = Math.ceil(remaining / 1000);
    els.timer.textContent = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
    els.timer.parentElement.classList.toggle('urgent', seconds <= 10);
    if (remaining <= 0) finishGame('timeout');
  }

  function capture() {
    if (!state.running || state.transitioning) return;
    const target = renderer.nearestMoth(state.moths);
    const threshold = 34;
    if (!target || target.distance > threshold) {
      pulseReticle('miss');
      playSound('miss');
      showFeedback('请将桦尺蛾对准中央');
      return;
    }
    const treeDistance = Math.hypot(renderer.camera.position[0] - target.moth.world[0], renderer.camera.position[2] - target.moth.world[2]);
    if (treeDistance > MAX_CAPTURE_DISTANCE) {
      pulseReticle('miss');
      playSound('miss');
      showFeedback('距离太远，请靠近树干');
      return;
    }
    const moth = target.moth;
    moth.alive = false;
    if (renderer.removeMoth) renderer.removeMoth(moth);
    state.captured[moth.type] += 1;
    state.totalCaptured += 1;
    pulseReticle('hit');
    burstParticles(moth.type);
    playSound('hit');
    els.captureCount.textContent = String(state.totalCaptured);
    showFeedback('已捕食 ' + state.totalCaptured + ' / ' + CAPTURE_GOAL);
    if (state.totalCaptured >= CAPTURE_GOAL) {
      state.running = false;
      const roundId = state.roundId;
      window.setTimeout(() => { if (roundId === state.roundId) finishGame('complete'); }, 520);
      return;
    }
    transitionScene();
  }

  function transitionScene() {
    state.transitioning = true;
    const roundId = state.roundId;
    const started = performance.now();
    releaseJoystick();
    state.drag = null;
    els.refreshNumber.textContent = String(state.totalCaptured).padStart(2, '0') + ' / 10';
    els.refresh.classList.add('show');
    els.canvas.classList.add('is-switching');
    state.transitionTimers.push(window.setTimeout(() => {
      if (roundId !== state.roundId) return;
      renderer.randomizeScene(state.theme, state.moths);
    }, 180));
    state.transitionTimers.push(window.setTimeout(() => {
      if (roundId !== state.roundId) return;
      els.canvas.classList.remove('is-switching');
      els.refresh.classList.remove('show');
      state.transitioning = false;
      state.deadline += performance.now() - started;
      state.transitionTimers = [];
    }, 560));
  }

  function finishGame(reason) {
    if (!els.result.classList.contains('is-hidden')) return;
    clearInterval(state.timerId);
    state.roundId += 1;
    state.running = false;
    state.transitioning = false;
    releaseJoystick();
    if (renderer.setActive) renderer.setActive(false);
    els.resultEnvironment.textContent = themeLabel();
    els.lightCaptured.textContent = String(state.captured.light);
    els.darkCaptured.textContent = String(state.captured.dark);
    els.result.classList.remove('is-hidden');
    els.status.textContent = (reason === 'complete' ? '实验完成。' : '时间到。') + '浅色桦尺蛾捕食 ' + state.captured.light + ' 只，深色桦尺蛾捕食 ' + state.captured.dark + ' 只。';
  }

  function showFeedback(message) {
    els.feedback.textContent = message;
    els.feedback.classList.add('show');
    els.status.textContent = message;
    clearTimeout(state.feedbackTimer);
    state.feedbackTimer = window.setTimeout(() => els.feedback.classList.remove('show'), 1400);
  }

  function pulseReticle(name) {
    els.reticle.classList.remove('hit', 'miss');
    void els.reticle.offsetWidth;
    els.reticle.classList.add(name);
  }

  function burstParticles(type) {
    const color = type === 'light' ? '#eee9db' : '#2d2925';
    for (let i = 0; i < 18; i += 1) {
      const particle = document.createElement('i');
      particle.className = 'particle';
      particle.style.setProperty('--particle-color', color);
      particle.style.setProperty('--dx', random(-105, 105) + 'px');
      particle.style.setProperty('--dy', random(-90, 90) + 'px');
      particle.style.setProperty('--spin', random(-240, 240) + 'deg');
      document.body.append(particle);
      window.setTimeout(() => particle.remove(), 620);
    }
  }

  function audioContext() {
    if (!state.audio) state.audio = new (window.AudioContext || window.webkitAudioContext)();
    if (state.audio.state === 'suspended') state.audio.resume();
    return state.audio;
  }

  function playSound(kind) {
    if (!state.sound) return;
    const context = audioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = kind === 'hit' ? 'sine' : 'triangle';
    oscillator.frequency.setValueAtTime(kind === 'hit' ? 640 : 160, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(kind === 'hit' ? 980 : 110, context.currentTime + .16);
    gain.gain.setValueAtTime(.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(kind === 'hit' ? .16 : .06, context.currentTime + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .2);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + .22);
  }

  function updateJoystick(event) {
    const rect = els.joystick.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const radius = rect.width * .29;
    const distance = Math.hypot(dx, dy) || 1;
    const factor = Math.min(1, radius / distance);
    const x = dx * factor; const y = dy * factor;
    els.knob.style.transform = 'translate(calc(-50% + ' + x + 'px), calc(-50% + ' + y + 'px))';
    const magnitude = Math.min(1, distance / radius);
    const response = magnitude <= .07 ? 0 : Math.pow((magnitude - .07) / .93, 1.4);
    state.joy.x = dx / distance * response;
    state.joy.y = dy / distance * response;
  }

  function releaseJoystick(event) {
    if (event && state.joy.pointerId !== event.pointerId) return;
    state.joy = { x: 0, y: 0, pointerId: null };
    state.joyFiltered = { x: 0, y: 0 };
    els.knob.style.transform = 'translate(-50%, -50%)';
  }

  function controlFrame(now) {
    const seconds = clamp((now - state.lastControlFrame) / 1000, 0, .10);
    state.lastControlFrame = now;
    if (renderer && state.running && !state.transitioning) {
      const smoothing = 1 - Math.exp(-seconds / .075);
      state.joyFiltered.x += (state.joy.x - state.joyFiltered.x) * smoothing;
      state.joyFiltered.y += (state.joy.y - state.joyFiltered.y) * smoothing;
      const forward = Number(state.keys.has('ArrowUp') || state.keys.has('KeyW'))
        - Number(state.keys.has('ArrowDown') || state.keys.has('KeyS'));
      const strafe = Number(state.keys.has('ArrowRight') || state.keys.has('KeyD'))
        - Number(state.keys.has('ArrowLeft') || state.keys.has('KeyA'));
      const length = Math.hypot(forward, strafe) || 1;
      if (forward || strafe || state.joy.pointerId !== null) {
        renderer.move((forward / length * 2.8 - state.joyFiltered.y * 2.8) * seconds, strafe / length * 2.8 * seconds);
      }
      if (state.joy.pointerId !== null) renderer.turn(state.joyFiltered.x * seconds * .95, 0);
    }
    requestAnimationFrame(controlFrame);
  }

  function returnToStart() {
    clearInterval(state.timerId);
    state.keys.clear();
    state.roundId += 1;
    state.running = false;
    state.transitioning = false;
    state.transitionTimers.forEach(clearTimeout);
    state.transitionTimers = [];
    releaseJoystick();
    state.drag = null;
    if (renderer && renderer.setActive) renderer.setActive(false);
    els.canvas.classList.remove('is-switching');
    els.refresh.classList.remove('show');
    els.result.classList.add('is-hidden');
    els.ready.classList.add('is-hidden');
    els.game.classList.add('is-hidden');
    els.start.classList.remove('is-hidden');
  }

  $$('.scene-card').forEach((button) => button.addEventListener('click', () => startGame(button.dataset.theme)));
  $$('.scene-photo img').forEach((img) => img.addEventListener('error', () => {
    if (img.dataset.fallback) {
      img.src = img.dataset.fallback;
      delete img.dataset.fallback;
    } else {
      img.hidden = true;
    }
  }));
  $('#exitButton').addEventListener('click', returnToStart);
  $('#backToStartButton').addEventListener('click', returnToStart);
  $('#retryLoadButton').addEventListener('click', () => {
    if (!renderer || !renderer.supported) return;
    renderer.reloadMoths();
    countdown(++state.roundId);
  });
  $('#replayButton').addEventListener('click', () => startGame(state.theme));
  $('#changeSceneButton').addEventListener('click', returnToStart);
  els.captureButton.addEventListener('click', capture);
  els.soundButton.addEventListener('click', () => {
    state.sound = !state.sound;
    els.soundButton.textContent = state.sound ? '♫' : '×';
    els.soundButton.setAttribute('aria-label', state.sound ? '关闭声音' : '打开声音');
  });

  els.viewport.addEventListener('pointerdown', (event) => {
    if (!state.running || state.transitioning) return;
    if (event.target.closest('.game-hud, .bottom-controls')) return;
    state.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    els.viewport.setPointerCapture(event.pointerId);
  });
  els.viewport.addEventListener('pointermove', (event) => {
    if (!state.drag || state.drag.id !== event.pointerId) return;
    const dx = event.clientX - state.drag.x;
    const dy = event.clientY - state.drag.y;
    state.drag.x = event.clientX;
    state.drag.y = event.clientY;
    if (renderer) renderer.rotate(dx, dy);
  });
  els.viewport.addEventListener('pointerup', () => { state.drag = null; });
  els.viewport.addEventListener('pointercancel', () => { state.drag = null; });
  els.viewport.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (renderer) renderer.zoom(event.deltaY * .018);
  }, { passive: false });

  els.joystick.addEventListener('pointerdown', (event) => {
    if (!state.running || state.transitioning || state.joy.pointerId !== null) return;
    event.preventDefault();
    state.joy.pointerId = event.pointerId;
    els.joystick.setPointerCapture(event.pointerId);
    updateJoystick(event);
  });
  els.joystick.addEventListener('pointermove', (event) => {
    if (state.joy.pointerId === event.pointerId) updateJoystick(event);
  });
  els.joystick.addEventListener('pointerup', releaseJoystick);
  els.joystick.addEventListener('pointercancel', releaseJoystick);
  els.joystick.addEventListener('lostpointercapture', releaseJoystick);

  const movementKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS']);
  window.addEventListener('keydown', (event) => {
    if (els.game.classList.contains('is-hidden')) return;
    if (movementKeys.has(event.code)) {
      event.preventDefault();
      state.keys.add(event.code);
    }
    if (event.code === 'Space') {
      event.preventDefault();
      if (!event.repeat) capture();
    }
  });
  window.addEventListener('keyup', (event) => state.keys.delete(event.code));
  window.addEventListener('blur', () => { state.keys.clear(); state.drag = null; releaseJoystick(); });
  window.addEventListener('resize', () => { releaseJoystick(); if (renderer) renderer.resize(); });
  if (document.addEventListener) document.addEventListener('visibilitychange', () => {
    if (document.hidden) { state.keys.clear(); state.drag = null; releaseJoystick(); }
  });
  requestAnimationFrame(controlFrame);

  const modelContext = document.modelContext;
  if (modelContext && modelContext.registerTool) {
    const tool = {
      name: 'start_peppered_moth_experiment',
      title: '开始桦尺蛾捕食实验',
      description: '选择浅色或深色森林，并在当前页面开始一局新的三维捕食实验。',
      inputSchema: {
        type: 'object',
        properties: { environment: { type: 'string', enum: ['pale', 'dark'] } },
        required: ['environment'],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || !['pale', 'dark'].includes(input.environment)) throw new Error('environment 必须是 pale 或 dark');
        startGame(input.environment);
        return {
          started: true,
          renderMode: 'WebGL 3D',
          environment: input.environment,
          initialLightMoths: MOTHS_PER_TYPE,
          initialDarkMoths: MOTHS_PER_TYPE,
          targetCaptures: CAPTURE_GOAL,
          timeLimitSeconds: TIME_LIMIT_MS / 1000
        };
      }
    };
    try {
      Promise.resolve(modelContext.registerTool(tool)).catch(() => {});
    } catch (_) {
      // Older browsers may expose an incomplete draft API.
    }
  }
})();

