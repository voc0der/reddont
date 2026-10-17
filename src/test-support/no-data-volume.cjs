// Preloaded before db.js in the data directory test. Hides a /data volume on
// the test machine, so the test can never open a real installation's database.
const fs = require("node:fs");
const existsSync = fs.existsSync;
fs.existsSync = (target) => target !== "/data" && existsSync(target);
