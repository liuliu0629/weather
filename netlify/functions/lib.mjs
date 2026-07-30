import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import webpush from "web-push";

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type"
    }
  });
}

export function getClientStore() {
  return getStore("weather-ping-clients");
}

export function clientIdFromSubscription(subscription) {
  return crypto.createHash("sha256").update(subscription.endpoint).digest("hex");
}

export async function readClient(id) {
  const store = getClientStore();
  return await store.get(id, { type: "json" });
}

export async function writeClient(id, data) {
  const store = getClientStore();
  await store.setJSON(id, { ...data, updatedAt: new Date().toISOString() });
}

export async function listClients() {
  const store = getClientStore();
  const result = await store.list();
  const clients = [];
  for (const blob of result.blobs || []) {
    const data = await store.get(blob.key, { type: "json" });
    if (data) clients.push({ id: blob.key, ...data });
  }
  return clients;
}

export async function deleteClient(id) {
  const store = getClientStore();
  await store.delete(id);
}

export function setupWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:weather-ping@example.com";
  if (!publicKey || !privateKey) {
    throw new Error("Missing VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return webpush;
}

export const weatherLabels = {
  0: "晴朗", 1: "大部晴朗", 2: "局部多云", 3: "阴天",
  45: "有雾", 48: "霜雾", 51: "小毛毛雨", 53: "毛毛雨", 55: "较强毛毛雨",
  56: "冻毛毛雨", 57: "强冻毛毛雨", 61: "小雨", 63: "中雨", 65: "大雨",
  66: "冻雨", 67: "强冻雨", 71: "小雪", 73: "中雪", 75: "大雪",
  77: "米雪", 80: "阵雨", 81: "较强阵雨", 82: "强阵雨",
  85: "阵雪", 86: "强阵雪", 95: "雷暴", 96: "雷暴伴冰雹", 99: "强雷暴伴冰雹"
};

export function formatChineseDate(date = new Date()) {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function formatHourLabel(time) {
  return new Date(time).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai"
  });
}

export async function fetchWeather(place) {
  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
    hourly: "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,wind_speed_10m,weather_code",
    minutely_15: "precipitation,precipitation_probability,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_probability_max",
    forecast_days: "2",
    timezone: "Asia/Shanghai"
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!response.ok) throw new Error(`Weather request failed: ${response.status}`);
  return response.json();
}

export function upcomingHours(weather, hourWindow = 6) {
  const now = Date.now();
  const max = now + hourWindow * 60 * 60 * 1000;
  return weather.hourly.time.map((time, index) => ({
    time,
    stamp: new Date(time).getTime(),
    rain: weather.hourly.precipitation_probability[index] ?? 0,
    temp: weather.hourly.temperature_2m[index] ?? weather.current.temperature_2m,
    apparent: weather.hourly.apparent_temperature?.[index] ?? weather.current.apparent_temperature ?? weather.current.temperature_2m,
    wind: weather.hourly.wind_speed_10m[index] ?? weather.current.wind_speed_10m,
    humidity: weather.hourly.relative_humidity_2m?.[index] ?? weather.current.relative_humidity_2m ?? 0,
    code: weather.hourly.weather_code[index] ?? weather.current.weather_code
  })).filter((item) => item.stamp >= now && item.stamp <= max).slice(0, 24);
}

export function upcomingRainSlots(weather, hourWindow = 6) {
  const source = weather.minutely_15;
  if (!source?.time?.length) return [];
  const now = Date.now();
  const max = now + hourWindow * 60 * 60 * 1000;
  return source.time.map((time, index) => ({
    time,
    stamp: new Date(time).getTime(),
    rain: source.precipitation_probability?.[index] ?? 0,
    precipitation: source.precipitation?.[index] ?? 0,
    code: source.weather_code?.[index] ?? 0
  })).filter((item) => item.stamp >= now && item.stamp <= max);
}

function isRainCode(code) {
  return [51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99].includes(code);
}

export function rainAdvice(weather, hourWindow = 6) {
  const hours = upcomingHours(weather, hourWindow);
  const slots = upcomingRainSlots(weather, hourWindow);
  const maxRain = Math.max(0, ...hours.map((item) => item.rain), ...slots.map((item) => item.rain));
  const rainy = slots.filter((item) => item.rain >= 45 || item.precipitation > 0 || isRainCode(item.code));
  const precise = rainy.length
    ? (() => {
        const first = rainy[0];
        const last = rainy[rainy.length - 1];
        const peak = rainy.reduce((best, item) => item.rain > best.rain ? item : best, rainy[0]);
        const start = formatHourLabel(first.time);
        const end = formatHourLabel(last.time);
        const peakTime = formatHourLabel(peak.time);
        return start === end
          ? `预计 ${start} 左右有雨，最高概率约 ${peak.rain}%`
          : `预计 ${start} 到 ${end} 有雨，${peakTime} 左右概率最高（约 ${peak.rain}%）`;
      })()
    : "";
  if (maxRain >= 70) return { level: "high", maxRain, text: `${precise || `最高降雨概率 ${maxRain}%`}，建议一定带伞。` };
  if (maxRain >= 45) return { level: "mid", maxRain, text: `${precise || `最高降雨概率 ${maxRain}%`}，建议带一把轻便伞。` };
  if (maxRain >= 25) return { level: "low", maxRain, text: `有一点降雨可能，最高 ${maxRain}%，长时间在外可备伞。` };
  return { level: "none", maxRain, text: `基本不下雨，最高降雨概率 ${maxRain}%，通常不用带伞。` };
}

export function clothesAdvice(weather, hours) {
  const apparent = Math.round(weather.current.apparent_temperature ?? weather.current.temperature_2m);
  const max = Math.round(weather.daily?.temperature_2m_max?.[0] ?? Math.max(...hours.map((item) => item.temp)));
  const min = Math.round(weather.daily?.temperature_2m_min?.[0] ?? Math.min(...hours.map((item) => item.temp)));
  const diff = max - min;
  let wear = "";
  if (apparent >= 33) wear = "体感很热，建议短袖短裤、透气鞋，尽量少穿深色厚衣服";
  else if (apparent >= 28) wear = "体感偏热，建议轻薄短袖、短裤或薄长裤";
  else if (apparent >= 23) wear = "体感舒适偏暖，短袖或薄长袖都可以";
  else if (apparent >= 17) wear = "早晚可能凉，建议长袖或带一件薄外套";
  else if (apparent >= 10) wear = "偏凉，建议外套、长裤";
  else wear = "较冷，建议厚外套和保暖内搭";
  const change = diff >= 9
    ? `昼夜温差约 ${diff}℃，建议分层穿，早晚加衣、中午可减衣。`
    : apparent >= 30
      ? "今天偏热，不建议添衣，出汗后注意补水。"
      : apparent <= 18
        ? "体感偏凉，建议添一件外套。"
        : "温差不大，正常穿着即可。";
  return { apparent, max, min, diff, text: `${wear}。${change}` };
}

export function makeDetailedAdvice(place, weather, hourWindow = 6) {
  const hours = upcomingHours(weather, hourWindow);
  const weatherName = weatherLabels[weather.current.weather_code] || "天气变化";
  const rain = rainAdvice(weather, hourWindow);
  const clothes = clothesAdvice(weather, hours);
  const maxWind = Math.round(Math.max(0, ...hours.map((item) => item.wind), weather.current.wind_speed_10m ?? 0));
  const humidity = Math.round(weather.current.relative_humidity_2m ?? Math.max(0, ...hours.map((item) => item.humidity)));
  const uv = Math.round(weather.daily?.uv_index_max?.[0] ?? 0);
  const windText = maxWind >= 39 ? `风很大，最高约 ${maxWind} km/h，骑车和打伞都要小心。`
    : maxWind >= 30 ? `风偏大，最高约 ${maxWind} km/h，建议固定帽子，伞选结实一点。`
    : `风不大，最高约 ${maxWind} km/h。`;
  const sunText = uv >= 8 ? "紫外线很强，建议防晒霜、太阳镜、帽子，尽量避开正午暴晒。"
    : uv >= 5 || clothes.max >= 30 ? "紫外线/日晒偏强，建议防晒和太阳镜。"
    : "日晒压力不高，普通防护即可。";
  const comfort = clothes.apparent >= 30 && humidity >= 70
    ? `体感闷热，湿度约 ${humidity}%，建议带水，通勤别走太急。`
    : `体感 ${clothes.apparent}℃，湿度约 ${humidity}%。`;
  const title = "明早出门建议";
  const body = `${place.name} ${formatChineseDate()}天气早报：${weatherName}，${comfort} ${rain.text} ${clothes.text} ${sunText} ${windText}`;
  return { title, body, weatherName, rain, clothes, maxWind, uv, windText, sunText };
}

export function minutesNowChina() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

export function scheduleDue(timeText, toleranceMinutes = 15) {
  const [hour, minute] = timeText.split(":").map(Number);
  const target = hour * 60 + minute;
  const now = minutesNowChina();
  const diff = Math.abs(now - target);
  return diff <= toleranceMinutes || Math.abs(diff - 1440) <= toleranceMinutes;
}
