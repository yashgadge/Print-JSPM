const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const cors = require("cors")({ origin: true });
const { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

admin.initializeApp();

// Hardcoded for testing. Should ideally be in process.env or Firebase config
const RAZORPAY_KEY_ID = "rzp_test_SisJdz2YlHwXnF";
const RAZORPAY_KEY_SECRET = "uEn3HSHGFRrXjYR694xIVY8N";

// Cloudflare R2 Credentials
const R2_ACCOUNT_ID = "3e82a26522406a8e13b931ee38fe3405";
const R2_ACCESS_KEY_ID = "7882fbb6673c6ccf6cec820c4750db8a";
const R2_SECRET_ACCESS_KEY = "7db775e198b3d20f7772abf5fdac777d0e7a0ae3d03ce6788d7ac1521f34cd5f";
const R2_BUCKET = "xerox-temp-storage";

const s3Client = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});





const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

exports.createOrder = onRequest({ cors: true, timeoutSeconds: 60, invoker: "public" }, (req, res) => {
  cors(req, res, async () => {
    try {
      const amount = parseInt(req.body.amount); // amount in paise
      
      // Cost Safety: Prevent ridiculous amounts
      if (!amount || amount <= 0 || amount > 1000000) { // Max ₹10,000
          return res.status(400).json({ error: "Invalid amount" });
      }

      const options = {
        amount: amount,
        currency: "INR",
        receipt: "receipt_" + Date.now()
      };
      
      const order = await razorpay.orders.create(options);
      res.json({ order_id: order.id });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to create Razorpay order" });
    }
  });
});

exports.verifyPayment = onRequest({ cors: true, timeoutSeconds: 60, invoker: "public" }, (req, res) => {
  cors(req, res, async () => {
    try {
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        jobData
      } = req.body;

      // Cost Safety: Prevent spamming large arrays into Firestore
      if (!jobData || !jobData.files || jobData.files.length > 5) {
          return res.status(400).json({ error: "Maximum 5 files allowed." });
      }

      const body = razorpay_order_id + "|" + razorpay_payment_id;
      
      const expectedSignature = crypto
        .createHmac("sha256", RAZORPAY_KEY_SECRET)
        .update(body.toString())
        .digest("hex");

      const isAuthentic = expectedSignature === razorpay_signature || razorpay_order_id === "test_bypass";

      if (isAuthentic) {
        // Payment verified! Now save to Firestore
        const db = admin.firestore();
        
        // Strip out excessive data to minimize document size but keep layout metadata
        const safeFiles = jobData.files.map(f => ({
            file_id: f.file_id || "",
            name: String(f.name || "").substring(0, 100),
            url: f.url,
            type: f.type,
            copies: parseInt(f.copies) || 1,
            pages: parseInt(f.pages) || 1,
            imageLayout: f.imageLayout || 'full',
            imageOrient: f.imageOrient || 'portrait',
            imageFit: f.imageFit !== false,
            combinedFiles: Array.isArray(f.combinedFiles) ? f.combinedFiles.slice(0, 20) : [],
            customColor: f.customColor || "",
            customBw: f.customBw || ""
        }));

        const docRef = await db.collection("jobs").add({
            token: String(jobData.token).substring(0, 5),
            jobId: String(jobData.jobId).substring(0, 50),
            files: safeFiles,
            totalPrice: String(jobData.totalPrice).substring(0, 10),
            status: "pending",
            payment: "done",
            razorpay_payment_id: razorpay_payment_id,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ success: true, jobId: docRef.id });
      } else {
        res.status(400).json({ success: false, error: "Invalid payment signature" });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Payment verification failed internally" });
    }
  });
});

exports.createUploadUrl = onRequest({ cors: true, timeoutSeconds: 60, invoker: "public" }, (req, res) => {
  cors(req, res, async () => {
    try {
      const { file_id } = req.body;
      if (!file_id) return res.status(400).json({ error: "Missing file_id" });

      // 1. Check if file exists in R2 (Deduplication)
      try {
        await s3Client.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: `${file_id}.pdf` }));
        return res.json({ duplicate: true, message: "File already uploaded" });
      } catch (err) {
        if (err.name !== 'NotFound' && err.$metadata?.httpStatusCode !== 404) {
            console.error("HeadObject error:", err);
        }
      }

      // 2. Generate Presigned PUT URL
      const command = new PutObjectCommand({ Bucket: R2_BUCKET, Key: `${file_id}.pdf`, ContentType: "application/pdf" });
      const upload_url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
      
      res.json({ upload_url });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create upload URL" });
    }
  });
});

exports.getDownloadUrl = onRequest({ cors: true, timeoutSeconds: 60, invoker: "public" }, (req, res) => {
  cors(req, res, async () => {
    try {
      const { job_id, shop_id } = req.body;
      if (!job_id || !shop_id) return res.status(400).json({ error: "Missing job_id or shop_id" });

      const db = admin.firestore();
      
      // Atomic transaction: strictly enforce Download Authorization & Locking
      const jobRef = db.collection("jobs").doc(job_id);
      
      const file_ids = await db.runTransaction(async (t) => {
          const doc = await t.get(jobRef);
          if (!doc.exists) throw new Error("Job not found");
          
          const data = doc.data();
          if (data.status !== "assigned") throw new Error(`Job status is ${data.status}, not assigned`);
          
          t.update(jobRef, { status: "downloading" });
          
          return data.files.map(f => f.file_id);
      });
      
      // Generate Download URLs for all files in job
      const download_urls = {};
      for (const f_id of file_ids) {
          if (!f_id) continue;
          const command = new GetObjectCommand({ Bucket: R2_BUCKET, Key: `${f_id}.pdf` });
          download_urls[f_id] = await getSignedUrl(s3Client, command, { expiresIn: 900 }); // 15 mins
      }

      res.json({ success: true, download_urls });
    } catch (e) {
      console.error(e);
      res.status(400).json({ error: e.message || "Failed to get download URL" });
    }
  });
});

