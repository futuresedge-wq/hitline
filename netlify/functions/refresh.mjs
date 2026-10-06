// Scheduled functions time out at 30s, so this only kicks off the background build (15 min limit).
export default async () => {
  await fetch(`${process.env.URL}/.netlify/functions/build-background`, {
    method: 'POST',
    headers: { 'x-refresh-key': process.env.REFRESH_KEY || '' },
  });
};
export const config = { schedule: '0 14 * * *' };
