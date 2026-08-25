export async function register() {
  if (process.env.CLOUDFLARE !== "1") return;
  // sql.js wasm boot currently takes down the Worker isolate.
  // Static routes work; first DB write (注册/登录) still needs a later fix.
}
