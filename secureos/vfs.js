// secureos/vfs.js — minimal VFS class over window.VFS (set by filesystem.js).
(function () {
  class VFS {
    constructor(fs) { this.fs = fs; }
    list(path = "/") { const dir = this._navigate(path); return (typeof dir === "object" && dir !== null) ? Object.keys(dir) : []; }
    read(path) { return this._navigate(path); }
    write(path, value) {
      const parts = path.split("/").filter(Boolean); let dir = this.fs["/"];
      for (let i = 0; i < parts.length - 1; i++) { if (!dir[parts[i]]) dir[parts[i]] = {}; dir = dir[parts[i]]; }
      dir[parts[parts.length - 1]] = value; window.VFS_save && window.VFS_save();
    }
    mkdir(path) {
      const parts = path.split("/").filter(Boolean); let dir = this.fs["/"];
      for (const part of parts) { if (!dir[part]) dir[part] = {}; dir = dir[part]; }
      window.VFS_save && window.VFS_save();
    }
    _navigate(path) {
      const parts = path.split("/").filter(Boolean); let dir = this.fs["/"];
      for (const part of parts) { if (!dir || !dir[part]) return null; dir = dir[part]; }
      return dir;
    }
  }
  if (window.VFS) window.vfs = new VFS(window.VFS);
})();
