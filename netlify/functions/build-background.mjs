import { getStore, connectLambda } from '@netlify/blobs';
import { build } from '../lib/build.mjs';

export const handler = async (event) => {
  connectLambda(event);
  const key = process.env.REFRESH_KEY;
  if (key && event.headers['x-refresh-key'] !== key) return { statusCode: 403 };
  const data = await build();
  const store = getStore('hitline');
  // Keep the last good data if this run found nothing
  if (!data.props.length && (await store.get('props'))) return { statusCode: 202 };
  await store.setJSON('props', data);
  return { statusCode: 202 };
};
