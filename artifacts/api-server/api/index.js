import { getApp } from "../dist/handler.mjs";

let appCache = null;

export default async function handler(req, res) {
  if (!appCache) appCache = await getApp();
  appCache(req, res);
}
