const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET     = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL; // e.g. https://pub-xxx.r2.dev

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const { action, filename, type } = event.queryStringParameters || {};

  try {
    // ── LIST ──────────────────────────────────────────
    if (action === 'list') {
      const params = { Bucket: BUCKET };
      if (event.queryStringParameters?.prefix) params.Prefix = event.queryStringParameters.prefix;
      const cmd = new ListObjectsV2Command(params);
      const res = await s3.send(cmd);
      const images = (res.Contents || [])
        .sort((a, b) => b.LastModified - a.LastModified)
        .map(obj => ({
          key:          obj.Key,
          url:          `${PUBLIC_URL}/${obj.Key}`,
          lastModified: obj.LastModified,
          size:         obj.Size,
        }));
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ images }),
      };
    }

    // ── PRESIGN ───────────────────────────────────────
    if (action === 'presign') {
      if (!filename) return { statusCode: 400, body: 'Missing filename' };
      const cmd = new PutObjectCommand({
        Bucket:      BUCKET,
        Key:         filename,
        ContentType: type || 'application/octet-stream',
      });
      const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 300 });
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadUrl, publicUrl: `${PUBLIC_URL}/${filename}` }),
      };
    }

    return { statusCode: 400, body: 'Unknown action. Use ?action=list or ?action=presign' };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};
