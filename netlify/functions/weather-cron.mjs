import {
  deleteClient,
  fetchWeather,
  listClients,
  makeDetailedAdvice,
  scheduleDue,
  setupWebPush
} from "./lib.mjs";

export default async function handler() {
  const webpush = setupWebPush();
  const clients = await listClients();
  const results = [];

  for (const client of clients) {
    try {
      const schedules = Array.isArray(client.schedules) ? client.schedules : [];
      const due = schedules.some((time) => scheduleDue(time, 7));
      if (!due || !client.subscription?.endpoint || !client.place) continue;

      const weather = await fetchWeather(client.place);
      const advice = makeDetailedAdvice(client.place, weather, 6);
      await webpush.sendNotification(
        client.subscription,
        JSON.stringify({ title: advice.title, body: advice.body, url: "/" }),
        { TTL: 60 * 60, urgency: "high", topic: "weather-ping" }
      );
      results.push({ id: client.id, ok: true });
    } catch (error) {
      const statusCode = error?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await deleteClient(client.id);
        results.push({ id: client.id, deleted: true });
      } else {
        results.push({ id: client.id, ok: false, error: String(error?.message || error) });
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, checked: clients.length, results }), {
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export const config = {
  schedule: "*/15 * * * *"
};
