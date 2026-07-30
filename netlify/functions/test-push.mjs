import { fetchWeather, json, makeDetailedAdvice, setupWebPush } from "./lib.mjs";

export default async function handler(request) {
  if (request.method === "OPTIONS") return json({});
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = await request.json();
  if (!body.subscription?.endpoint || !body.place) {
    return json({ error: "Missing subscription or place" }, 400);
  }

  const weather = await fetchWeather(body.place);
  const advice = makeDetailedAdvice(body.place, weather, 6, body.thresholds);
  const webpush = setupWebPush();
  await webpush.sendNotification(
    body.subscription,
    JSON.stringify({
      title: advice.title,
      body: advice.body,
      url: "/"
    }),
    { TTL: 60 * 30, urgency: "high" }
  );

  return json({ ok: true, advice });
}
