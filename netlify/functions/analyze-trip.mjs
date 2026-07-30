import { displayPlaceName, fetchWeather, formatHourLabel, json, makeDetailedAdvice, weatherLabels } from "./lib.mjs";

function parseItinerary(text) {
  const pattern = /(上午|下午|晚上|中午|早上|明天)?\s*(\d{1,2})(?:[:：点时](\d{1,2})?)?/g;
  const items = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    let hour = Number(match[2]);
    const minute = Number(match[3] || 0);
    const prefix = match[1] || "";
    if ((prefix === "下午" || prefix === "晚上") && hour < 12) hour += 12;
    if (prefix === "中午" && hour < 11) hour += 12;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      const context = text.slice(Math.max(0, match.index - 12), Math.min(text.length, match.index + 32)).replace(/\s+/g, " ");
      items.push({ hour, minute, label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, context });
    }
  }
  return items.slice(0, 12);
}

function findWeatherNearTime(weather, item, tomorrow) {
  const target = new Date();
  target.setHours(item.hour, item.minute, 0, 0);
  if (tomorrow) target.setDate(target.getDate() + 1);
  const candidates = weather.hourly.time.map((time, index) => ({
    time,
    stamp: new Date(time).getTime(),
    rain: weather.hourly.precipitation_probability?.[index] ?? 0,
    temp: weather.hourly.temperature_2m?.[index] ?? weather.current.temperature_2m,
    apparent: weather.hourly.apparent_temperature?.[index] ?? weather.current.apparent_temperature ?? weather.current.temperature_2m,
    wind: weather.hourly.wind_speed_10m?.[index] ?? weather.current.wind_speed_10m,
    code: weather.hourly.weather_code?.[index] ?? weather.current.weather_code
  }));
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate.stamp - target.getTime()) < Math.abs(best.stamp - target.getTime()) ? candidate : best,
  candidates[0]);
}

function adviceForTripItem(weather, item, tomorrow, text) {
  const point = findWeatherNearTime(weather, item, tomorrow);
  const codeName = weatherLabels[point.code] || "天气变化";
  const rain = point.rain ?? 0;
  const apparent = Math.round(point.apparent);
  const wind = Math.round(point.wind);
  const isOutdoor = /骑车|步行|走路|跑步|通勤|出门|地铁|公交|开车|机场|火车|户外|逛|吃饭|回家|上班|下班/.test(item.context + text);
  const tips = [];
  if (rain >= 65) tips.push("大概率有雨，一定带伞，鞋子尽量选不怕湿的");
  else if (rain >= 40) tips.push("可能有雨，建议带伞");
  else tips.push("下雨概率不高，一般不用带伞");
  if (apparent >= 30) tips.push("体感热，穿轻薄短袖，少穿外套");
  else if (apparent <= 18) tips.push("体感偏凉，建议加一件外套");
  else tips.push("体感较舒适，正常穿着即可");
  if (wind >= 30) tips.push("风偏大，骑车/打伞注意");
  if (isOutdoor && rain >= 40) tips.push("室外路段尽量提前出门或走有遮挡路线");
  return `${item.label}：${codeName}，体感约 ${apparent}℃，降雨概率 ${rain}%，风速约 ${wind} km/h。${tips.join("；")}。`;
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return json({});
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await request.json();
  if (!body.place || !body.itinerary) return json({ error: "Missing place or itinerary" }, 400);

  const weather = await fetchWeather(body.place);
  const items = parseItinerary(body.itinerary);
  const tomorrow = /明天/.test(body.itinerary);
  const fallback = makeDetailedAdvice(body.place, weather, 12);
  const lines = items.length
    ? items.map((item) => adviceForTripItem(weather, item, tomorrow, body.itinerary))
    : [fallback.body];
  return json({ ok: true, title: `${displayPlaceName(body.place)} 行程天气建议`, body: lines.join("\n"), lines });
}
