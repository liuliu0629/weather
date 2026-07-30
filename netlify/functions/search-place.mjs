import { json } from "./lib.mjs";

function compact(value) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

async function searchWithAmap(keyword, city) {
  const key = process.env.AMAP_KEY;
  if (!key) return null;
  const params = new URLSearchParams({
    key,
    keywords: keyword,
    city: city || "",
    citylimit: "false",
    offset: "10",
    page: "1",
    extensions: "all",
    output: "JSON"
  });
  const response = await fetch(`https://restapi.amap.com/v3/place/text?${params}`);
  if (!response.ok) throw new Error(`Amap place search failed: ${response.status}`);
  const data = await response.json();
  if (data.status !== "1") throw new Error(data.info || "Amap place search failed");
  const pois = Array.isArray(data.pois) ? data.pois : [];
  return pois
    .map((poi) => {
      const [longitude, latitude] = String(poi.location || "").split(",").map(Number);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      const province = compact(poi.pname);
      const cityName = compact(poi.cityname) || province;
      const district = compact(poi.adname);
      const address = compact(poi.address);
      const name = compact(poi.name);
      const detailName = [district, address, name].filter(Boolean).join("");
      return {
        provider: "amap",
        name: cityName || name || "我的位置",
        admin1: province,
        district,
        country: "中国",
        latitude,
        longitude,
        detailName: detailName || name,
        formattedAddress: [province, cityName, district, address, name].filter(Boolean).join(" · "),
        poiName: name,
        address
      };
    })
    .filter(Boolean);
}

async function searchWithOpenMeteo(keyword) {
  const params = new URLSearchParams({
    name: keyword,
    count: "10",
    language: "zh",
    format: "json"
  });
  const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  if (!response.ok) throw new Error(`OpenMeteo geocoding failed: ${response.status}`);
  const data = await response.json();
  return (data.results || []).map((place) => ({
    provider: "openmeteo",
    name: place.name,
    admin1: place.admin1 || "",
    country: place.country || "",
    latitude: place.latitude,
    longitude: place.longitude,
    detailName: "",
    formattedAddress: [place.name, place.admin1, place.country].filter(Boolean).join(" · ")
  }));
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return json({});
  const url = new URL(request.url);
  const keyword = (url.searchParams.get("keyword") || "").trim();
  const city = (url.searchParams.get("city") || "").trim();
  if (!keyword) return json({ ok: true, results: [] });

  try {
    const amap = await searchWithAmap(keyword, city);
    if (amap?.length) return json({ ok: true, provider: "amap", results: amap });
  } catch (error) {
    console.warn("Amap place search failed", error);
  }

  try {
    const fallback = await searchWithOpenMeteo(keyword);
    return json({ ok: true, provider: "openmeteo", results: fallback });
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error), results: [] }, 500);
  }
}
