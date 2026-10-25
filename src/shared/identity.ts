import { createHash } from "node:crypto";
/**
 * Browser User identity as it crosses the Web Server → Host seam.
 *
 * The Web Server authenticates a person against Gitea (ADR-0004) and forwards
 * only the Gitea login name on the private, bearer-token-protected Host
 * transport. The Host uses that name as a directory segment, so it is
 * normalised and validated identically on both sides.
 */
export const USER_HEADER = "x-pi-coffee-user";
/** Authenticated actor, forwarded only by the trusted Web gateway. */
export const ACTOR_HEADER = "x-pi-coffee-actor";

/** Gitea login names: letters, digits, `.`, `-`, `_`; lowercased for stable paths. */
const USERNAME = /^[a-z0-9][a-z0-9._-]{0,39}$/;

/**
 * Lowercased, validated login name, or undefined when the value cannot be a
 * safe path segment (empty, too long, `..`, path separators, spaces, …).
 */
export function normalizeUsername(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const user = raw.trim().toLowerCase();
  if (!USERNAME.test(user)) return undefined;
  if (user === "." || user === ".." || user.includes("..")) return undefined;
  return user;
}

/** Parse `PI_COFFEE_ALLOWED_USERS=alice,Bob` into normalised names; invalid entries are dropped. */
export function parseAllowedUsers(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => normalizeUsername(item))
    .filter((item): item is string => item !== undefined);
}

/** Stable task runtime namespace across users sharing one OS account. */
export function taskNamespace(user:string|undefined,id:string):string {return user===undefined ? id : createHash("sha256").update(JSON.stringify([user,id])).digest("hex");}
