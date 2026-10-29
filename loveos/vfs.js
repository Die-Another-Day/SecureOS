// loveos/vfs.js
(function () {
    // Initial in-memory filesystem
    const fileSystem = {
        "/": {
            home: {
                user: {
                    "readme.txt": "Welcome to LoveX OS ❤️\nType 'help' for available commands."
                }
            },
            apps: {},
            docs: {}
        }
    };

    // Core VFS functions
    // loveos/vfs.js
class VFS {
    constructor(fs) {
        this.fs = fs;
    }

    list(path = "/") {
        const dir = this._navigate(path);
        if (typeof dir === "object" && dir !== null) {
            return Object.keys(dir);
        }
        return [];
    }

    read(path) {
        return this._navigate(path);
    }

    write(path, value) {
        const parts = path.split("/").filter(Boolean);
        let dir = this.fs["/"];
        for (let i = 0; i < parts.length - 1; i++) {
            if (!dir[parts[i]]) dir[parts[i]] = {};
            dir = dir[parts[i]];
        }
        dir[parts[parts.length - 1]] = value;
        window.VFS_save();
    }

    mkdir(path) {
        const parts = path.split("/").filter(Boolean);
        let dir = this.fs["/"];
        for (let i = 0; i < parts.length; i++) {
            if (!dir[parts[i]]) dir[parts[i]] = {};
            dir = dir[parts[i]];
        }
        window.VFS_save();
    }

    _navigate(path) {
        const parts = path.split("/").filter(Boolean);
        let dir = this.fs["/"];
        for (const part of parts) {
            if (!dir[part]) return null;
            dir = dir[part];
        }
        return dir;
    }
}

// Link class to your saved filesystem
window.vfs = new VFS(window.VFS);
})();
