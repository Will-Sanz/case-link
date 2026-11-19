/** Serve-only listener setting. Public site/recovery settings and the Next environment stay separate.
 * @param {Record<string, string | undefined>} system
 */
export function parentAppBind(system = process.env) {
  const origin = system.CASELINK_PARENT_APP_BIND_ORIGIN ?? "http://127.0.0.1:3200";
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{3,4})$/.exec(origin);
  if (!match || Number(match[1]) < 1024 || Number(match[1]) > 65535)
    throw new Error("Choose an unprivileged http://127.0.0.1 app listener origin.");
  return { origin, hostname: "127.0.0.1", port: match[1] };
}
