import { json } from "./lib.mjs";

function pickString(value) {
  if (!value || Array.isArray(value)) return "";
  return String(value);
}

function compactJoin(parts, separator = "") {
  return parts.filter(Boolean).join(separator).replace(/\s+/g, "");
}

async function reverseWithAmap(latitude, longitude) {
  const key = process.env.AMAP_KEY;
  if (!key) return null;
  const params = new URLSearchParams({
    key,
    location: `${Number(longitude).toFixed(6)},${Number(latitude).toFixed(6)}`,
    extensions: "all",
    radius: "1000",
    roadlevel: "0",
    output: "JSON"
  });
  const response = await fetch(`https://restapi.amap.com/v3/geocode/regeo?${params}`);
  if (!response.ok) throw new Error(`Amap reverse geocode failed: ${response.status}`);
  const data = await response.json();
  if (data.status !== "1" || !data.regeocode) throw new Error(data.info || "Amap reverse geocode failed");

  const regeocode = data.regeocode;
  const component = regeocode.addressComponent || {};
  const neighborhood = component.neighborhood || {};
  const building = component.building || {};
  const streetNumber = component.streetNumber || {};
  const pois = Array.isArray(regeocode.pois) ? regeocode.pois : [];
  const aois = Array.isArray(regeocode.aois) ? regeocode.aois : [];
  const nearestPoi = pois[0] || {};
  const nearestAoi = aois[0] || {};

  const province = pickString(component.province);
  const city = pickString(component.city) || province;
  const district = pickString(component.district);
  const township = pickString(component.township);
  const street = pickString(streetNumber.street);
  const number = pickString(streetNumber.number);
  const neighborhoodName = pickString(neighborhood.name);
  const buildingName = pickString(building.name);
  const poiName = pickString(nearestPoi.name);
  const aoiName = pickString(nearestAoi.name);
  const formatted = pickString(regeocode.formatted_address);

  const detailName = compactJoin([
    district,
    township,
    street,
    number,
    neighborhoodName || aoiName,
    buildingName,
    poiName && poiName !== neighborhoodName && poiName !== aoiName ? poiName : ""
  ]);

  return {
    provider: "amap",
    name: city || province || "我的位置",
    admin1: province,
    district,
    township,
    country: "中国",
    latitude,
    longitude,
    detailName: detailName || formatted,
    formattedAddress: formatted,
    poiName,
    aoiName,
    buildingName,
    streetAddress: compactJoin([street, number])
  };
}

async function reverseWithBigDataCloud(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    localityLanguage: "zh"
  });
  const response = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?${params}`);
  if (!response.ok) throw new Error(`BigDataCloud reverse geocode failed: ${response.status}`);
  const data = await response.json();
  const city = data.city || data.locality || data.principalSubdivision || "我的位置";
  return {
    provider: "bigdatacloud",
    name: city,
    admin1: data.principalSubdivision || "",
    district: data.localityInfo?.administrative?.find((item) => item.adminLevel === 6)?.name || "",
    township: data.locality || "",
    country: data.countryName || "",
    latitude,
    longitude,
    detailName: compactJoin([data.locality, data.city, data.principalSubdivision]),
    formattedAddress: [data.locality, data.city, data.principalSubdivision, data.countryName].filter(Boolean).join(" · ")
  };
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return json({});
  const url = new URL(request.url);
  const latitude = Number(url.searchParams.get("latitude"));
  const longitude = Number(url.searchParams.get("longitude"));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return json({ error: "Missing latitude or longitude" }, 400);
  }

  try {
    const result = await reverseWithAmap(latitude, longitude);
    if (result) return json({ ok: true, ...result });
  } catch (error) {
    console.warn("Amap reverse geocode failed", error);
  }

  try {
    return json({ ok: true, ...(await reverseWithBigDataCloud(latitude, longitude)) });
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error) }, 500);
  }
}
