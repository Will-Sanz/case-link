// Test-only forwarding to the strict synthetic SSR Auth fixture. Never load in an app deployment.
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (url.origin === "http://127.0.0.1:55321") {
    if (url.search || !((method === "GET" && url.pathname === "/auth/v1/user") || (method === "POST" && url.pathname === "/rest/v1/rpc/parent_ensure_account"))) throw new Error("Unexpected synthetic SSR Auth request.");
    url.port = "3318";
    return nativeFetch(input instanceof Request ? new Request(url, input) : url, init);
  }
  if (!['http://127.0.0.1:3308', 'http://localhost:3308'].includes(url.origin)) throw new Error("External requests are closed during synthetic assistant UI testing.");
  return nativeFetch(input, init);
};
