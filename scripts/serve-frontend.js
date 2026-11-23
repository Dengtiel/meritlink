/**
 * Tiny static server for the MeritLink web page (no extra dependencies).
 *   npm run frontend   ->  http://localhost:5173
 * Serves frontend/ and exposes deployments/*.json and the compiled ABI so the page can
 * find the contract automatically.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const PORT = process.env.PORT || 5173;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const routes = {
  "/abi.json": () => {
    const art = path.join(root, "artifacts/contracts/MeritLinkRegistry.sol/MeritLinkRegistry.json");
    return JSON.stringify(JSON.parse(fs.readFileSync(art, "utf8")).abi);
  },
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    try {
      if (routes[url]) {
        res.writeHead(200, { "Content-Type": types[".json"] });
        return res.end(routes[url]());
      }
      let file;
      if (url.startsWith("/deployments/")) file = path.join(root, path.normalize(url));
      else file = path.join(root, "frontend", path.normalize(url === "/" ? "/index.html" : url));
      const allowed = [path.join(root, "frontend"), path.join(root, "deployments")];
      if (!allowed.some((dir) => file.startsWith(dir)) || !fs.existsSync(file)) {
        res.writeHead(404);
        return res.end("Not found");
      }
      res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  })
  .listen(PORT, () => console.log(`MeritLink web page: http://localhost:${PORT}`));
