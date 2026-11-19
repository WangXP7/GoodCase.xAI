// tools/city/config.mjs — city configs (tools/city/cities/<id>.mjs) and where their data lives
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function loadCity(id) {
  if (!id || !/^[a-z0-9-]+$/.test(id)) throw new Error('usage: <city> (a tools/city/cities/<city>.mjs config)');
  return (await import(new URL(`./cities/${id}.mjs`, import.meta.url).href)).default;
}

// Downloads: GEO_DATA/<city> when set, else tools/data/<city>
export const dataDir = (city) => path.join(process.env.GEO_DATA || fileURLToPath(new URL('../data/', import.meta.url)), city.id);
