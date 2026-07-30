import { json } from "./lib.mjs";

export default async function handler(request) {
  if (request.method === "OPTIONS") return json({});
  return json({
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || "",
    timezone: "Asia/Shanghai"
  });
}
