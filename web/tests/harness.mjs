import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../dist/", import.meta.url));
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
};
export async function forwardRpc(url, payload) {
  const args = [
    "--silent",
    "--show-error",
    "--max-time",
    "45",
    "-H",
    "Content-Type: application/json",
    "--data-binary",
    JSON.stringify(payload),
    url,
  ];
  if (new URL(url).hostname === "127.0.0.1" && process.env.HTTP_PROXY)
    args.unshift("-x", process.env.HTTP_PROXY, "--noproxy", "");
  const { stdout } = await exec("curl", args, { maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}
export async function server({ rpcUrl } = {}) {
  const rpcCache = new Map();
  const s = http.createServer(async (req, res) => {
    try {
      if (req.url === "/rpc") {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const payload = JSON.parse(Buffer.concat(chunks));
        const key = JSON.stringify(payload);
        let response = rpcCache.get(key);
        if (!response) {
          response = await forwardRpc(rpcUrl, payload);
          if (
            ["eth_getCode", "eth_call", "eth_chainId"].includes(
              payload.method,
            ) &&
            !JSON.parse(response).error
          )
            rpcCache.set(key, response);
        }
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(response);
        return;
      }
      const pathname = decodeURIComponent(req.url.split("?")[0]);
      const local = pathname.startsWith("/preview/")
        ? pathname.slice(9)
        : pathname.slice(1);
      const file = path.resolve(root, local || "index.html");
      if (!file.startsWith(root)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const data = fs.readFileSync(file);
      res.writeHead(200, {
        "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      });
      res.end(data);
    } catch (e) {
      res.writeHead(404);
      res.end(e.message);
    }
  });
  await new Promise((resolve) => s.listen(0, "127.0.0.1", resolve));
  return {
    s,
    url: `http://127.0.0.1:${s.address().port}/preview/`,
    close: () => new Promise((resolve) => s.close(resolve)),
    rpcUrl: `http://127.0.0.1:${s.address().port}/rpc`,
  };
}
