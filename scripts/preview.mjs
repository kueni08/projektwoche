import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
const root = resolve("public");
createServer(async (req, res) => {
  try {
    const path = resolve(
      root,
      "." +
        decodeURIComponent(
          new URL(req.url, "http://localhost").pathname === "/"
            ? "/index.html"
            : new URL(req.url, "http://localhost").pathname,
        ),
    );
    if (!path.startsWith(root + "/") && !path.startsWith(root + "\\"))
      throw Error();
    const data = await readFile(path);
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css",
        ".js": "text/javascript",
        ".svg": "image/svg+xml",
      }[extname(path)] || "application/octet-stream",
    );
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
}).listen(4173, "127.0.0.1", () => console.log("http://127.0.0.1:4173"));
