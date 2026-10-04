import { getStore } from '@netlify/blobs';

// Serves the cached dataset built by build-background.
export default async () => {
  const data = await getStore('hitline').get('props', { type: 'json' });
  if (!data) {
    return Response.json({ error: 'Data is still loading. The first refresh can take a few minutes.' }, { status: 503 });
  }
  return Response.json(data, { headers: { 'cache-control': 'public, max-age=60' } });
};
export const config = { path: '/api/props' };
