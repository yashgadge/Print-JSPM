export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. UPLOAD FILE DIRECTLY VIA BINDING (No API Keys)
    // POST /upload?file_id=123
    if (request.method === 'POST' && url.pathname === '/upload') {
      const file_id = url.searchParams.get('file_id');
      if (!file_id) return new Response('Missing file_id', { status: 400 });

      // Deduplication check
      const existing = await env.TEMP_STORAGE.head(`${file_id}.pdf`);
      if (existing) {
        return new Response(JSON.stringify({ duplicate: true }), { status: 200 });
      }

      // Stream directly to R2 bucket binding
      await env.TEMP_STORAGE.put(`${file_id}.pdf`, request.body, {
        httpMetadata: { contentType: request.headers.get('content-type') || 'application/pdf' }
      });

      return new Response(JSON.stringify({ success: true, file_id }), { status: 200 });
    }

    // 2. DOWNLOAD AUTHORIZATION (Locking)
    if (request.method === 'POST' && url.pathname === '/start-download') {
      const { job_id, shop_id } = await request.json();
      
      // Here you would do the atomic update in Firebase.
      // E.g., await updateFirebaseStatus(job_id, shop_id);
      
      // Since the Local Agent has the R2 API keys, we just tell it it's safe to download.
      return new Response(JSON.stringify({ success: true, status: "downloading" }), { status: 200 });
    }

    return new Response('Not Found', { status: 404 });
  }
};
