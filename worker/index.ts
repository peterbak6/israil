// Cloudflare Worker. Static assets are served before this code runs; only /api/* reaches it.
// This is the place for server-side features later, e.g. a scheduled GTFS refresh or a trip planner API.
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, app: "israil" });
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  },
} satisfies ExportedHandler;
