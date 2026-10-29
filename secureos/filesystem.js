// secureos/filesystem.js — local virtual filesystem, SecureOS defaults.
(function () {
  const KEY = "secureos_vfs_v1";
  const defaults = {
    "/": {
      "readme.txt": "Welcome to SecureOS v1.0\nLocal-first analyst console.\nOpen the SOC Center, or type 'help' in Secure Terminal.\nLab use only — never scan systems you do not own.",
      "home": { "user": { "notes": {}, "cases": {} } },
      "etc": { "config.json": JSON.stringify({ theme: "dark-soc", version: "1.0" }, null, 2) },
      "apps": {}
    }
  };
  let vfs;
  try { vfs = JSON.parse(localStorage.getItem(KEY)) || defaults; } catch { vfs = defaults; }
  window.VFS = vfs;
  window.VFS_save = function () { try { localStorage.setItem(KEY, JSON.stringify(window.VFS)); } catch {} };
  window.vfsList = (path = "/") => Object.keys(window.VFS[path] || {});
  window.vfsRead = (path = "/", name) => (window.VFS[path] && name in window.VFS[path]) ? window.VFS[path][name] : null;
  window.vfsWrite = (path = "/", name, content) => { if (!window.VFS[path]) window.VFS[path] = {}; window.VFS[path][name] = content; window.VFS_save(); };
  window.vfsMkdir = (path = "/", name) => { if (!window.VFS[path]) window.VFS[path] = {}; if (!window.VFS[path][name]) window.VFS[path][name] = {}; window.VFS_save(); };
})();
