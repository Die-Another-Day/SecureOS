// loveos/filesystem.js
(function () {
  const KEY = "lovex_vfs_v1";

  const defaults = {
    "/": {
      "readme.txt":
        "Welcome to LoveX OS 💖\nType 'help' to get started.",
      "poem.txt":
        "Roses are red,\nViolets are blue,\nThis Love OS,\nWas made just for you 💕",
      "home": { "user": { "notes": {}, "pictures": {} } },
      "etc": { "config.json": JSON.stringify({ theme: "pink", username: "Pawanu" }, null, 2) },
      "apps": {}
    }
  };

  let vfs;
  try { vfs = JSON.parse(localStorage.getItem(KEY)) || defaults; }
  catch { vfs = defaults; }

  // expose globally
  window.VFS = vfs;

  // simple persistence helper
  window.VFS_save = function () {
    try { localStorage.setItem(KEY, JSON.stringify(window.VFS)); } catch {}
  };

  // tiny helpers used by terminal (optional)
  window.vfsList = (path = "/") => Object.keys(window.VFS[path] || {});
  window.vfsRead = (path = "/", name) =>
    (window.VFS[path] && name in window.VFS[path]) ? window.VFS[path][name] : null;
  window.vfsWrite = (path = "/", name, content) => {
    if (!window.VFS[path]) window.VFS[path] = {};
    window.VFS[path][name] = content;
    window.VFS_save();
  };
  window.vfsMkdir = (path = "/", name) => {
    if (!window.VFS[path]) window.VFS[path] = {};
    if (!window.VFS[path][name]) window.VFS[path][name] = {};
    window.VFS_save();
  };
})();
