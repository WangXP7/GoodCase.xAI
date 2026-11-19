import { initEmbed } from '@genex-ai/embed-sdk';
import { GENEX } from '../../src/genex.config';
let initialized = false;
export function bootIdentity() {
  if (initialized) return;
  initialized = true;
  initEmbed({ slug: GENEX.slug, apiUrl: GENEX.apiUrl, dashboardOrigins: GENEX.dashboardOrigins });
}
