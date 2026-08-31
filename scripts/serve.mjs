import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { handleTemperatureRequest } from "../server/temperature-api.js";

const root = resolve(process.cwd());
const requestedPort = Number(process.env.PORT || 4173);
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname === "/api/temperature-range") {
    const apiResponse = await handleTemperatureRequest(new Request(requestUrl, { method: request.method }), process.env);
    const headers = Object.fromEntries(apiResponse.headers);
    const origin = request.headers.origin;
    if (origin && /^https?:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers.Vary = "Origin";
    }
    response.writeHead(apiResponse.status, headers);
    response.end(Buffer.from(await apiResponse.arrayBuffer()));
    return;
  }
  const candidate = normalize(join(root, pathname === "/" ? "index.html" : pathname));

  if (!candidate.startsWith(root) || !existsSync(candidate) || !statSync(candidate).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, { "content-type": types[extname(candidate)] || "application/octet-stream" });
  createReadStream(candidate).pipe(response);
});

let activePort = requestedPort;
server.on("error", (error) => {
  const canTryNextPort = error.code === "EADDRINUSE" && !process.env.PORT && activePort < requestedPort + 4;
  if (!canTryNextPort) throw error;
  activePort += 1;
  server.listen(activePort, "127.0.0.1");
});
server.on("listening", () => {
  console.log(`Weather Compare: http://127.0.0.1:${activePort}`);
});
server.listen(activePort, "127.0.0.1");
