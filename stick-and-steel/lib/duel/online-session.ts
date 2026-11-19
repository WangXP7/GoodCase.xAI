import { waitForPlayer, getColyseusAuth, getColyseusUrls } from '@genex-ai/embed-sdk';
import { matchmake } from '@genex-ai/multiplayer';
import { bootIdentity } from './embed';
import { GENEX } from '../../src/genex.config';
import type { Profile } from './network';

/** Browser-only entry: preserve static links to the SDK even in the minified build. */
export async function joinOnlineSession(isCurrent: () => boolean) {
  bootIdentity();
  const { user } = await waitForPlayer();
  if (!isCurrent()) return null;
  if (!getColyseusAuth()) throw new Error('Online play needs a player session. Open the published game to join.');
  return matchmake<Profile>({
    urls: getColyseusUrls(), room: GENEX.slug, name: user.name,
    auth: () => getColyseusAuth(),
  });
}
