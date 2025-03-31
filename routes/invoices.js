const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const mysql = require("mysql2/promise");
const verifyToken = require("../middleware/auth");
const Stripe = require("stripe");
require("dotenv").config();

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const upload = multer({ dest: "uploads/" });

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

// Upload invoice (JWT secured)
router.post("/upload", verifyToken, upload.single("invoice"), async (req, res) => {
  const filePath = req.file.path;
  const userId = req.user.id;
  const utilityType = "electric"; // Later make dynamic
  const unitType = utilityType === "water" ? "m³" : "kWh";
  const ratePerUnit = 0.34;

  try {
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(dataBuffer);
    const text = pdfData.text;

    const periodMatch = text.match(/(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/);
    const usageMatch = text.match(/([\d,.]+)\s*kWh/);
    const provider = "Sample Energy Co";
    const account = "ACC12345678";

    const billingStart = periodMatch ? periodMatch[1] : null;
    const billingEnd = periodMatch ? periodMatch[2] : null;
    const usage = usageMatch ? parseFloat(usageMatch[1].replace(",", "")) : null;

    const subtotal = usage ? parseFloat((usage * ratePerUnit).toFixed(2)) : null;
    const markup = subtotal ? parseFloat((subtotal * 0.10).toFixed(2)) : null;
    const totalCost = subtotal && markup ? parseFloat((subtotal + markup).toFixed(2)) : null;

    const connection = await mysql.createConnection(dbConfig);
    await connection.execute(
      `INSERT INTO invoices 
      (user_id, utility_type, provider_name, account_number, billing_period_start, billing_period_end, \`usage\`, unit_type, rate_per_unit, subtotal, markup, total_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        utilityType,
        provider,
        account,
        billingStart,
        billingEnd,
        usage,
        unitType,
        ratePerUnit,
        subtotal,
        markup,
        totalCost
      ]
    );

    await connection.end();
    fs.unlinkSync(filePath);

    res.status(200).json({
      message: "Invoice uploaded and processed",
      billing_period_start: billingStart,
      billing_period_end: billingEnd,
      usage,
      unit_type: unitType,
      subtotal,
      markup,
      total_cost: totalCost,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to process invoice" });
  }
});

// Stripe payment session
router.post("/pay/:invoiceId", verifyToken, async (req, res) => {
  const userId = req.user.id;
  const invoiceId = req.params.invoiceId;

  try {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute(
      "SELECT * FROM monthly_invoices WHERE id = ? AND user_id = ?",
      [invoiceId, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    const invoice = rows[0];

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: `Billhub Invoice - ${invoice.month}/${invoice.year}`,
            },
            unit_amount: Math.round(invoice.total_cost_with_markup * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: "http://localhost:3000/payment-success",
      cancel_url: "http://localhost:3000/payment-cancelled",
      metadata: {
        invoice_id: invoiceId,
        user_id: userId
      }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Payment session failed" });
  }
});

module.exports = router;
