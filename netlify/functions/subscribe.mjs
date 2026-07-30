import { clientIdFromSubscription, json, writeClient } from "./lib.mjs";

export default async function handler(request) {
  if (request.method === "OPTIONS") return json({});
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = await request.json();
  if (!body.subscription?.endpoint) {
    return json({ error: "Missing push subscription" }, 400);
  }

  const id = clientIdFromSubscription(body.subscription);
  await writeClient(id, {
    subscription: body.subscription,
    place: body.place,
    leadTime: body.leadTime || "180",
    schedules: Array.isArray(body.schedules) ? body.schedules : [],
    rules: body.rules || {},
    thresholds: body.thresholds || {},
    itinerary: body.itinerary || "",
    userAgent: request.headers.get("user-agent") || "",
    createdAt: body.createdAt || new Date().toISOString()
  });

  return json({ ok: true, id });
}
