(function() {
  // Load toolbar HTML & CSS
  fetch('loveos/toolbar.html')
    .then(res => res.text())
    .then(html => {
      document.getElementById('desktop').insertAdjacentHTML('afterbegin', html);
      return fetch('loveos/toolbar.css');
    })
    .then(res => res.text())
    .then(css => {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
      initToolbar();
    })
    .catch(err => console.error("Toolbar load error:", err));

  function initToolbar() {
    const menuBtn = document.getElementById('menu-btn');
    const menuDropdown = document.getElementById('menu-dropdown');
    const logoutBtn = document.getElementById('logout-btn');
    const timeEl = document.getElementById('time');

    // Toggle menu
    menuBtn.addEventListener('click', () => {
      menuDropdown.classList.toggle('hidden');
    });

    // Menu actions
    menuDropdown.addEventListener('click', (e) => {
      if (e.target.classList.contains('menu-item')) {
        openApp(e.target.dataset.app);
        menuDropdown.classList.add('hidden');
      }
    });

    // Shortcuts
    document.getElementById('notepad-btn').addEventListener('click', () => openApp('notepad'));
    document.getElementById('terminal-btn').addEventListener('click', () => openApp('terminal'));

    // Logout
    logoutBtn.addEventListener('click', () => {
      if (confirm("Are you sure you want to log out of Love OS? 💔")) {
        localStorage.removeItem('loveos_user');
        location.reload();
      }
    });

    // Time update
    function updateTime() {
      const now = new Date();
      timeEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
                           ' | ' +
                           now.toLocaleDateString();
    }
    updateTime();
    setInterval(updateTime, 1000);
  }

function openApp(app) {
  const appTitles = {
    terminal: "💻 Love Terminal",
    notepad: "📜 Love Notes",
    files: "📂 Memory Chest",
    settings: "⚙️ Cupid Settings",
    messages: "💌 Message Box"
  };

  const appPaths = {
    terminal: "apps/terminal.html",
    notepad: "apps/notepad.html",
    files: "apps/files.html",
    settings: "apps/settings.html",
    messages: "apps/messages.html"
  };

  // If it's the terminal, make it a floating panel
  if (app === "terminal") {
    const termDiv = document.createElement("div");
    termDiv.className = "floating-terminal";
    
    const titleBar = document.createElement("div");
    titleBar.className = "terminal-titlebar";
    titleBar.innerHTML = `
      <span>Love Terminal</span>
      <button class="close-btn">✖</button>
  `;

    const iframe = document.createElement("iframe");
    iframe.src = appPaths[app];
    iframe.className = "terminal-content";

    termDiv.appendChild(titleBar);
    termDiv.appendChild(iframe);
    document.body.appendChild(termDiv);

    makeDraggable(termDiv); // still draggable

    titleBar.querySelector(".close-btn").addEventListener("click", () => {
    termDiv.remove();
  });
  
    return;
  }

  // For all other apps, make the normal window
  const win = document.createElement("div");
  win.className = "app-windowss";
  win.innerHTML = `
    <div class="app-titlebar">
      <span>${appTitles[app]}</span>
      <button class="close-btn">✖</button>
    </div>
    <iframe src="${appPaths[app]}" class="app-content"></iframe>
  `;

  
  makeDraggable(win);
  document.body.appendChild(win);
  win.querySelector(".close-btn").addEventListener("click", () => win.remove());
}

function makeDraggable(el) {
  const header = el.querySelector(".app-titlebar") || el; // fallback for frameless terminal
  let offsetX = 0, offsetY = 0, isDown = false;

  header.addEventListener("mousedown", (e) => {
    isDown = true;
    offsetX = e.clientX - el.offsetLeft;
    offsetY = e.clientY - el.offsetTop;
    el.style.zIndex = 9999;
  });

  document.addEventListener("mouseup", () => isDown = false);
  document.addEventListener("mousemove", (e) => {
    if (!isDown) return;
    el.style.left = (e.clientX - offsetX) + "px";
    el.style.top = (e.clientY - offsetY) + "px";
  });
}
})();