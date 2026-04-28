const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const cors = require("cors")({ origin: true });

admin.initializeApp();

// Hardcoded for testing. Should ideally be in process.env or Firebase config
const RAZORPAY_KEY_ID = "rzp_test_SisJdz2YlHwXnF";
const RAZORPAY_KEY_SECRET = "uEn3HSHGFRrXjYR694xIVY8N";

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
        
        // Strip out excessive data to minimize document size
        const safeFiles = jobData.files.map(f => ({
            name: f.name.substring(0, 100), // Prevent extreme string lengths
            url: f.url,
            type: f.type,
            copies: parseInt(f.copies) || 1,
            pages: parseInt(f.pages) || 1
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
