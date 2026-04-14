exports.handler = async function (event) {
  const id = (event.queryStringParameters || {}).id;
  if (!id) return { statusCode: 400, body: 'Missing id parameter' };

  const url = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    JSON.parse(text); // validate it's real JSON before serving it
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300', // cache for 5 minutes
      },
      body: text,
    };
  } catch (err) {
    return { statusCode: 502, body: `Could not load config: ${err.message}` };
  }
};
