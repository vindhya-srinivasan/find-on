// Person 2: small helpers shared by API routes.
export function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}
export function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
/** Placeholder for routes not built yet. Person 1 uses lib/mock.ts until a route stops returning this. */
export function notImplemented(route: string) {
  return Response.json({ error: `${route} not implemented yet` }, { status: 501 });
}
