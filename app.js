/* LoveOS client logic with Toolbar */

document.addEventListener('DOMContentLoaded', () => {
  // DOM refs
  const loginOverlay = document.getElementById('loginOverlay');
  const loginBtn = document.getElementById('loginBtn');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const loginMsg = document.getElementById('loginMsg');
  const desktop = document.getElementById('desktop');
  const taskUser = document.getElementById('taskUser');
  const loveIcon = document.getElementById('loveIcon');
  const windows = document.getElementById('windows');
  const floatingHearts = document.getElementById('floatingHearts');

  const SECRET = 'love'; // default password

  // Inject Toolbar into DOM
  function createToolbar() {
    const toolbar = document.createElement('div');
    toolbar.id = 'love-toolbar';
    toolbar.innerHTML = `
      <div class="toolbar-left">
        <button id="menuBtn">☰</button>
        <div id="menuDropdown" class="hidden">
          <div class="menu-item" data-app="terminal">💻 Love Terminal</div>
          <div class="menu-item" data-app="notes">📜 Love Notes</div>
          <div class="menu-item" data-app="files">📂 Memory Chest</div>
          <div class="menu-item" data-app="settings">⚙️ Cupid Settings</div>
          <div class="menu-item" data-app="messages">💌 Message Box</div>
        </div>
        <button class="shortcut" data-app="notes">📜 Love Notes</button>
        <button class="shortcut" data-app="terminal">💻 Love Terminal</button>
      </div>
      <div class="toolbar-right">
        <button id="logoutBtn">💔 Break Up</button>
        <div class="time-date">
          <div id="clock"></div>
          <div class="phrase">Every second with you matters</div>
        </div>
      </div>
    `;
    document.body.prepend(toolbar);

    // Toolbar events
    const menuBtn = toolbar.querySelector('#menuBtn');
    const menuDropdown = toolbar.querySelector('#menuDropdown');
    menuBtn.addEventListener('click', () => {
      menuDropdown.classList.toggle('hidden');
    });

    // App shortcuts
    toolbar.querySelectorAll('.shortcut, .menu-item').forEach(btn => {
      btn.addEventListener('click', () => {
        alert(`Opening: ${btn.dataset.app}`);
        menuDropdown.classList.add('hidden');
      });
    });

    // Logout
    toolbar.querySelector('#logoutBtn').addEventListener('click', () => {
      if (confirm('Are you sure you want to log out of Love OS?')) {
        localStorage.removeItem('loveos_user');
        location.reload();
      }
    });

    // Clock updater
    function updateClock() {
      const now = new Date();
      toolbar.querySelector('#clock').textContent = now.toLocaleTimeString();
    }
    updateClock();
    setInterval(updateClock, 1000);
  }

  // show desktop
  function showDesktop(name) {
    loginOverlay.classList.add('hidden');
    loginOverlay.style.display = 'none';
    desktop.classList.remove('hidden');
    taskUser.textContent = name || 'guest';
    localStorage.setItem('loveos_user', name || 'guest');
    startFloatingHearts();
    createToolbar();
  }

  // login click
  loginBtn.addEventListener('click', () => {
    const user = usernameInput.value.trim();
    const pass = passwordInput.value.trim();
    if (!user) {
      loginMsg.textContent = 'Please type her name ❤️';
      return;
    }
    if (pass === SECRET) {
      showDesktop(user);
    } else {
      loginMsg.textContent = "Hmm, that doesn't feel right... try again.";
      passwordInput.value = '';
    }
  });

  // if username stored
  const saved = localStorage.getItem('loveos_user');
  if (saved) {
    usernameInput.value = saved;
  }

  // Love App click
  loveIcon.addEventListener('click', openLoveApp);

  function openLoveApp() {
    const existing = document.querySelector('.app-window');
    if (existing) {
      existing.style.zIndex = 999;
      return;
    }
    const win = document.createElement('div');
    win.className = 'app-window';
    win.innerHTML = `
      <div class="app-header">
        <div class="app-title">Love App</div>
        <div><button class="btn closeBtn" title="Close">✕</button></div>
      </div>
      <div class="app-body">
        <div class="greet">Hello, <span id="gName"></span> 💕</div>
        <div class="typewriter" id="typewriter"></div>
        <button class="heart-btn" id="heartBtn">Send a Heart</button>
        <div class="muted small" style="margin-top:10px">Tap the heart, watch the magic ✨</div>
      </div>
    `;
    windows.appendChild(win);
    document.getElementById('gName').textContent = localStorage.getItem('loveos_user') || 'My Love';
    win.querySelector('.closeBtn').addEventListener('click', () => win.remove());
    const lines = [
      "On this special day I want you to know...",
      "You're the melody in my favourite song,",
      "the smile I chase, and the calm in my storm.",
      "I love you more than words can hold. 💖"
    ];
    typeWriter(lines, document.getElementById('typewriter'));
    document.getElementById('heartBtn').addEventListener('click', (e) => burstHearts(e.target));
  }

  function typeWriter(lines, el, speed = 28, linePause = 600) {
    el.innerHTML = '';
    let i = 0;
    function nextLine() {
      if (i >= lines.length) return;
      const text = lines[i++];
      let idx = 0;
      const span = document.createElement('span');
      el.appendChild(span);
      const t = setInterval(() => {
        if (idx < text.length) {
          span.textContent += text[idx++];
        } else {
          clearInterval(t);
          el.appendChild(document.createElement('br'));
          setTimeout(nextLine, linePause);
        }
      }, speed);
    }
    nextLine();
  }

  function burstHearts(target) {
    const rect = target.getBoundingClientRect();
    const seedX = rect.left + rect.width / 2;
    const seedY = rect.top + rect.height / 2;
    for (let i = 0; i < 12; i++) {
      const h = document.createElement('div');
      h.className = 'small-heart';
      h.style.position = 'fixed';
      h.style.left = (seedX + (Math.random() - 0.5) * 120) + 'px';
      h.style.top = (seedY + (Math.random() - 0.5) * 60) + 'px';
      h.style.width = (8 + Math.random() * 10) + 'px';
      h.style.height = h.style.width;
      h.style.background = `radial-gradient(circle at 30% 30%, #fff, ${['#ff6fa3','#ff3d9a','#ff90c1'][Math.floor(Math.random() * 3)]})`;
      h.style.transform = `rotate(${Math.random() * 45}deg)`;
      h.style.borderRadius = '6px 6px 12px 12px';
      h.style.zIndex = 9999;
      h.style.pointerEvents = 'none';
      document.body.appendChild(h);
      const animDuration = 1000 + Math.random() * 900;
      h.animate([
        { transform: `translateY(0) scale(0.8)`, opacity: 1 },
        { transform: `translateY(-120px) translateX(${(Math.random() - 0.5) * 100}px) scale(1)`, opacity: 0 }
      ], { duration: animDuration, easing: 'cubic-bezier(.2,.8,.2,1)' });
      setTimeout(() => h.remove(), animDuration + 40);
    }
  }

  function startFloatingHearts() {
    const colors = ['#ffd6ea', '#ffb3d6', '#ff7ab6', '#ff4da6'];
    setInterval(() => {
      const h = document.createElement('div');
      h.className = 'float-heart';
      const size = 12 + Math.random() * 28;
      h.style.width = h.style.height = size + 'px';
      h.style.left = Math.random() * 100 + '%';
      h.style.top = 100 + 'vh';
      h.style.position = 'fixed';
      h.style.zIndex = 1;
      h.style.pointerEvents = 'none';
      h.style.background = colors[Math.floor(Math.random() * colors.length)];
      h.style.opacity = (0.2 + Math.random() * 0.6).toString();
      h.style.borderRadius = '50%';
      floatingHearts.appendChild(h);
      const floatDur = 7000 + Math.random() * 9000;
      h.animate([
        { transform: `translateY(0) scale(0.6)`, opacity: h.style.opacity },
        { transform: `translateY(-120vh) scale(1.1)`, opacity: 0 }
      ], { duration: floatDur, easing: 'linear' });
      setTimeout(() => h.remove(), floatDur + 40);
    }, 750);
  }
});
