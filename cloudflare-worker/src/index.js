import { AwsClient } from 'aws4fetch';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;

    // Initialize AWS Client for Presigning
    // NOTE: These MUST be set as secrets using `wrangler secret put`
    const s3 = new AwsClient({
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      service: 's3',
      region: 'auto',
    });

    const bucketUrl = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}`;

    // 1. POST /create-upload-url
    if (method === 'POST' && url.pathname === '/create-upload-url') {
      const { file_id } = await request.json();
      if (!file_id) return new Response('Missing file_id', { status: 400 });

      // Check if file exists using R2 Binding
      const exists = await env.R2_BUCKET.head(`${file_id}.pdf`);
      if (exists) {
        return new Response(JSON.stringify({ duplicate: true }), { 
          status: 200, 
          headers: { 'Content-Type': 'application/json' } 
        });
      }

      // Generate Presigned PUT URL
      const putUrl = new URL(`${bucketUrl}/${file_id}.pdf`);
      putUrl.searchParams.set('X-Amz-Expires', '3600');
      const presigned = await s3.sign(new Request(putUrl, { method: 'PUT' }), {
        aws: { signQuery: true },
      });

      return new Response(JSON.stringify({ upload_url: presigned.url }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 2. POST /get-download-url
    if (method === 'POST' && url.pathname === '/get-download-url') {
      const { job_id, shop_id, file_id } = await request.json();
      
      // Validation Logic (Mocked - replace with actual Firebase/Logic check)
      // status should be 'assigned'
      
      // Generate Presigned GET URL
      const getUrl = new URL(`${bucketUrl}/${file_id}.pdf`);
      getUrl.searchParams.set('X-Amz-Expires', '900'); // 15 mins
      const presigned = await s3.sign(new Request(getUrl, { method: 'GET' }), {
        aws: { signQuery: true },
      });

      return new Response(JSON.stringify({ download_url: presigned.url }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 3. POST /delete-file
    if (method === 'POST' && url.pathname === '/delete-file') {
      const { file_id } = await request.json();
      if (!file_id) return new Response('Missing file_id', { status: 400 });

      await env.R2_BUCKET.delete(`${file_id}.pdf`);
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};
