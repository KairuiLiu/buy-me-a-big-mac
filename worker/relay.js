// The old generic browser-to-MCP relay has been retired. Keep the export only
// to fail closed for stale integrations; all public reads use worker/api.js.
export function handleMcp() {
  return new Response(JSON.stringify({ error: '查询接口已更新，请刷新页面' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
