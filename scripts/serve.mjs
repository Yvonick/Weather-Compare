import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { handleTemperatureRequest } from "../server/temperature-api.js";
import { handleShareRequest } from "../server/shares.js";
import { openLocalShareDatabase } from "./local-share-db.mjs";
import { Readable } from "node:stream";

const root = resolve(process.cwd());
let shareDb;
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

  if (pathname === "/api/shares" || pathname.startsWith("/s/")) {
    const options = { method: request.method, headers: request.headers };
    if (!["GET", "HEAD"].includes(request.method)) {
      options.body = Readable.toWeb(request);
      options.duplex = "half";
    }
    try {
      shareDb ||= openLocalShareDatabase(root);
      const result = await handleShareRequest(new Request(requestUrl, options), { DB: shareDb });
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      console.error("Local sharing failed", error);
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Short links are temporarily unavailable." }));
    }
    return;
  }
  if (pathname.split("/").some((part) => part.startsWith("."))) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

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
