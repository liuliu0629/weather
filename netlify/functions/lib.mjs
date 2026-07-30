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

export const defaultThresholds = {
  rain: 45,
  heavyRain: 70,
  hot: 30,
  cold: 18,
  tempDiff: 9,
  uv: 5,
  wind: 30
};

function clampNumber(value, fallback, min, max) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function sanitizeThresholds(value = {}) {
  const merged = { ...defaultThresholds, ...(value || {}) };
  return {
    rain: clampNumber(merged.rain, defaultThresholds.rain, 1, 100),
    heavyRain: clampNumber(merged.heavyRain, defaultThresholds.heavyRain, 1, 100),
    hot: clampNumber(merged.hot, defaultThresholds.hot, -20, 60),
    cold: clampNumber(merged.cold, defaultThresholds.cold, -30, 40),
    tempDiff: clampNumber(merged.tempDiff, defaultThresholds.tempDiff, 1, 30),
    uv: clampNumber(merged.uv, defaultThresholds.uv, 1, 12),
    wind: clampNumber(merged.wind, defaultThresholds.wind, 1, 120)
  };
}

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

export function rainAdvice(weather, hourWindow = 6, thresholds = defaultThresholds) {
  const t = sanitizeThresholds(thresholds);
  const hours = upcomingHours(weather, hourWindow);
  const slots = upcomingRainSlots(weather, hourWindow);
  const maxRain = Math.max(0, ...hours.map((item) => item.rain), ...slots.map((item) => item.rain));
  const rainy = slots.filter((item) => item.rain >= t.rain || item.precipitation > 0 || isRainCode(item.code));
  const precise = rainy.length
    ? (() => {
        const first = rainy[0];
        const last = rainy[rainy.length - 1];
        const peak = rainy.reduce((best, item) => item.rain > best.rain ? item : best, rainy[0]);
        const start = formatHourLabel(first.time);
        const end = formatHourLabel(last.time);
        return start === end
          ? `${start}有雨`
          : `${start}-${end}有雨`;
      })()
    : "";
  if (maxRain >= t.heavyRain) return { level: "high", maxRain, text: `${precise || `雨概率${maxRain}%`}；带伞。` };
  if (maxRain >= t.rain) return { level: "mid", maxRain, text: `${precise || `雨概率${maxRain}%`}；带伞。` };
  return { level: "none", maxRain, text: "少雨。" };
}

export function clothesAdvice(weather, hours, thresholds = defaultThresholds) {
  const t = sanitizeThresholds(thresholds);
  const apparent = Math.round(weather.current.apparent_temperature ?? weather.current.temperature_2m);
  const max = Math.round(weather.daily?.temperature_2m_max?.[0] ?? Math.max(...hours.map((item) => item.temp)));
  const min = Math.round(weather.daily?.temperature_2m_min?.[0] ?? Math.min(...hours.map((item) => item.temp)));
  const diff = max - min;
  let wear = "";
  if (apparent >= t.hot + 3) wear = "很热，短袖短裤";
  else if (apparent >= t.hot) wear = "偏热，轻薄短袖";
  else if (apparent >= 23) wear = "短袖或薄长袖";
  else if (apparent >= t.cold) wear = "可带薄外套";
  else if (apparent >= 10) wear = "外套、长裤";
  else wear = "厚外套保暖";
  const change = diff >= t.tempDiff
    ? `温差${diff}℃，分层穿。`
    : apparent >= t.hot
      ? "注意补水。"
      : apparent <= t.cold
        ? "体感偏凉，建议添一件外套。"
        : "温差不大，正常穿着即可。";
  return { apparent, max, min, diff, text: `${wear}。${change}` };
}

export function makeDetailedAdvice(place, weather, hourWindow = 6, thresholds = defaultThresholds) {
  const t = sanitizeThresholds(thresholds);
  const hours = upcomingHours(weather, hourWindow);
  const weatherName = weatherLabels[weather.current.weather_code] || "天气变化";
  const rain = rainAdvice(weather, hourWindow, t);
  const clothes = clothesAdvice(weather, hours, t);
  const maxWind = Math.round(Math.max(0, ...hours.map((item) => item.wind), weather.current.wind_speed_10m ?? 0));
  const uv = Math.round(weather.daily?.uv_index_max?.[0] ?? 0);
  const windText = maxWind >= t.wind + 9 ? `风很大，最高${maxWind}km/h，骑车打伞小心。`
    : maxWind >= t.wind ? `风偏大，最高${maxWind}km/h。`
    : "风不大。";
  const sunText = uv >= t.uv + 3 ? "强防晒。"
    : uv >= t.uv || clothes.max >= t.hot ? "注意防晒。"
    : "";
  const title = "天气出门建议";
  const body = `${displayPlaceName(place)}：${weatherName}，体感${clothes.apparent}℃。${[rain.text, clothes.text, sunText].filter(Boolean).join(" ")}`;
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

export function chinaDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

export function scheduleDue(timeText, toleranceMinutes = 15) {
  const [hour, minute] = timeText.split(":").map(Number);
  const target = hour * 60 + minute;
  const now = minutesNowChina();
  const diff = Math.abs(now - target);
  return diff <= toleranceMinutes || Math.abs(diff - 1440) <= toleranceMinutes;
}

export function displayPlaceName(place) {
  const provinceCity = `${place.admin1 || ""}${place.name || ""}`;
  const district = place.district || "";
  const township = place.township || "";
  if (/北京/.test(provinceCity)) return district || "北京";
  if (township) return `${district && !township.includes(district) ? district : ""}${township}`;
  if (district) return district;
  const name = place.name || "当前位置";
  return name.length > 8 ? "当前位置" : name;
}
