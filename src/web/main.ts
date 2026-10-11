import { readFileSync } from "node:fs";
import { parseUserRoutes, type IdentityOptions } from "./identity.js";
import { WebServer, type TlsMaterial } from "./server.js";
import {restartOptions} from './restart.js';

const tls = loadTls();
const server = new WebServer({
  restart:restartOptions(),
  host: envString("PI_COFFEE_WEB_BIND", "127.0.0.1"),
  port: envNumber("PI_COFFEE_WEB_PORT", 3000),
  hostUrl: envString("PI_COFFEE_HOST_URL", "ws://127.0.0.1:8788/host"),
  hostToken: process.env.PI_COFFEE_HOST_TOKEN,
  identity: identityOptions(),
  allowUnauthenticated: process.env.PI_COFFEE_ALLOW_UNAUTHENTICATED === "1",
  ...(tls === undefined ? {} : { tls }),
});

await server.start();
console.log(`Web ${server.scheme}://${server.address().host}:${server.address().port}/`);

const shutdown = async () => server.close();
process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

function envString(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? fallback : value;
}

function envNumber(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function loadTls(): TlsMaterial | undefined {
  const certPath = process.env.PI_COFFEE_WEB_TLS_CERT?.trim();
  const keyPath = process.env.PI_COFFEE_WEB_TLS_KEY?.trim();
  if (!certPath && !keyPath) return undefined;
  if (!certPath || !keyPath) throw new Error("PI_COFFEE_WEB_TLS_CERT and PI_COFFEE_WEB_TLS_KEY must be set together");
  return { cert: readFileSync(certPath), key: readFileSync(keyPath) };
}

function identityOptions(): IdentityOptions | undefined {
  const routeFile = process.env.PI_COFFEE_ROUTES_FILE;
  if (!routeFile) return undefined;
  const required = (key: string) => {
    const value = process.env[key];
    if (!value) throw new Error(`${key} is required for multi-user mode`);
    return value;
  };
  return {
    sharedHost:process.env.PI_COFFEE_SHARED_HOST === "1",
    giteaUrl: required("PI_COFFEE_GITEA_URL"),
    clientId: required("PI_COFFEE_GITEA_CLIENT_ID"),
    clientSecret: required("PI_COFFEE_GITEA_CLIENT_SECRET"),
    publicUrl: required("PI_COFFEE_PUBLIC_URL"),
    routes: () => parseUserRoutes(readFileSync(routeFile, "utf8")),
  };
}
