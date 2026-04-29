import { AwsClient } from 'aws4fetch';

// This is a robust AWS Signature V4 client for fetching presigned URLs from R2
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Setup AWS Client for R2 Presigned URLs
    const r2 = new AwsClient({
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      service: 's3',
      region: 'auto',
    });

    const bucketUrl = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/xerox-temp-storage`;

    // 1. CREATE UPLOAD URL
    if (request.method === 'POST' && url.pathname === '/create-upload-url') {
      const { file_id } = await request.json();

      if (!file_id) {
        return new Response('Missing file_id', { status: 400 });
      }

      // Check if file already exists in R2 (Deduplication)
      const headReq = await r2.fetch(`${bucketUrl}/${file_id}.pdf`, { method: 'HEAD' });
      if (headReq.status === 200) {
        return new Response(JSON.stringify({ duplicate: true, message: "File already uploaded" }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Generate Presigned PUT URL
      const putUrl = new URL(`${bucketUrl}/${file_id}.pdf`);
      putUrl.searchParams.set('X-Amz-Expires', '3600'); // 1 hour expiration
      
      const presignedReq = await r2.sign(new Request(putUrl, { method: 'PUT' }), {
        aws: { signQuery: true },
      });

      return new Response(JSON.stringify({ upload_url: presignedReq.url }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. GET DOWNLOAD URL (Authorized download)
    if (request.method === 'POST' && url.pathname === '/get-download-url') {
      const { job_id, shop_id } = await request.json();

      // Here you would validate with Firebase/Firestore
      // If validation fails or status != 'assigned', return 403.
      // E.g., await validateJobWithFirebase(job_id, shop_id);

      // Transition state: assigned -> downloading (Atomic update in Firestore)
      // await updateJobStatus(job_id, "downloading");

      // Generate Presigned GET URL
      // The file_id should be fetched from the database based on the job_id
      const file_id = "test-file-id"; // Mock
      
      const getUrl = new URL(`${bucketUrl}/${file_id}.pdf`);
      getUrl.searchParams.set('X-Amz-Expires', '900'); // 15 mins expiration
      
      const presignedReq = await r2.sign(new Request(getUrl, { method: 'GET' }), {
        aws: { signQuery: true },
      });

      return new Response(JSON.stringify({ download_url: presignedReq.url }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};
