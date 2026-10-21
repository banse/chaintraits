import { execFileSync } from "node:child_process";
export const rpc = (url, method, params = []) => {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const args = [
    "--silent",
    "--show-error",
    "--max-time",
    "90",
    "-H",
    "Content-Type: application/json",
    "--data-binary",
    body,
    url,
  ];
  if (new URL(url).hostname === "127.0.0.1" && process.env.HTTP_PROXY)
    args.unshift("-x", process.env.HTTP_PROXY, "--noproxy", "");
  const response = JSON.parse(
    execFileSync("curl", args, {
      maxBuffer: 16 * 1024 * 1024,
      encoding: "utf8",
    }),
  );
  if (response.error) throw Error(JSON.stringify(response.error));
  return response.result;
};
