const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const mysql = require("mysql2/promise");
const authenticateToken = require("../middleware/auth");
require("dotenv").config();

// ✅ Multer setup for invoice upload
const upload = multer({ dest: "uploads/" });

// ✅ Database config
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

// 📥 Upload PDF invoice and parse contents
router.post("/upload", authenticateToken, upload.single("invoice"), async (req, res) => {
  const filePath = req.file.path;
  const userId = req.user.id;
  const utilityType = req.body.utilityType || "electric"; // Can be gas or water

  try {
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(dataBuffer);
    const text = pdfData.text;

    // Basic parsing logic
    const periodMatch = text.match(/(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/);
    const usageMatch = text.match(/([\d,.]+)\s*(kWh|m3)/i);
    const costMatch = text.match(/£([\d,.]+)/);

    const billing_period_start = periodMatch ? periodMatch[1] : null;
    const billing_period_end = periodMatch ? periodMatch[2] : null;
    const usage = usageMatch ? parseFloat(usageMatch[1].replace(",", "")) : null;
    const unit_type = usageMatch ? usageMatch[2] : null;
    const subtotal = costMatch ? parseFloat(costMatch[1].replace(",", "")) : null;
    const markup = subtotal ? parseFloat((subtotal * 0.10).toFixed(2)) : 0;
    const total_cost = subtotal ? parseFloat((subtotal + markup).toFixed(2)) : null;

    const connection = await mysql.createConnection(dbConfig);
    await connection.execute(
      `INSERT INTO invoices (
        user_id, utility_type, billing_period_start, billing_period_end,
        usage, unit_type, subtotal, markup, total_cost
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        utilityType,
        billing_period_start,
        billing_period_end,
        usage,
        unit_type,
        subtotal,
        markup,
        total_cost,
      ]
    );
    await connection.end();

    fs.unlinkSync(filePath);

    res.status(200).json({
      message: "Invoice uploaded and processed successfully",
      billing_period_start,
      billing_period_end,
      usage,
      unit_type,
      subtotal,
      markup,
      total_cost,
    });
  } catch (err) {
    console.error("Upload Error:", err);
    res.status(500).json({ message: "Failed to process invoice" });
  }
});

// 📊 Consolidate monthly invoices and apply markup
router.post("/consolidate/:userId", authenticateToken, async (req, res) => {
  const userId = req.params.userId;

  try {
    const connection = await mysql.createConnection(dbConfig);
    const [results] = await connection.execute(`
      SELECT 
        MONTH(STR_TO_DATE(billing_period_start, '%d/%m/%Y')) AS month,
        YEAR(STR_TO_DATE(billing_period_start, '%d/%m/%Y')) AS year,
        SUM(usage) AS total_usage,
        unit_type,
        SUM(subtotal) AS subtotal,
        SUM(markup) AS total_markup,
        SUM(total_cost) AS total_cost
      FROM invoices
      WHERE user_id = ?
      GROUP BY year, month, unit_type
    `, [userId]);

    for (const row of results) {
      await connection.execute(`
        INSERT INTO monthly_invoices (user_id, month, year, total_usage, usage_unit, total_cost_before_markup, total_markup, total_cost_with_markup)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
          total_usage = VALUES(total_usage),
          total_cost_before_markup = VALUES(total_cost_before_markup),
          total_markup = VALUES(total_markup),
          total_cost_with_markup = VALUES(total_cost_with_markup)
      `, [
        userId,
        row.month,
        row.year,
        row.total_usage,
        row.unit_type,
        row.subtotal,
        row.total_markup,
        row.total_cost
      ]);
    }

    await connection.end();
    res.json({ message: "Monthly invoices consolidated", data: results });
  } catch (error) {
    console.error("Consolidation Error:", error);
    res.status(500).json({ message: "Error consolidating invoices" });
  }
});

// 📄 View consolidated monthly invoices
router.get("/monthly/:userId", authenticateToken, async (req, res) => {
  const userId = req.params.userId;

  try {
    const connection = await mysql.createConnection(dbConfig);
    const [invoices] = await connection.execute(`
      SELECT id, month, year, total_usage, usage_unit, total_cost_with_markup, paid_status, created_at
      FROM monthly_invoices
      WHERE user_id = ?
      ORDER BY year DESC, month DESC
    `, [userId]);

    await connection.end();
    res.json({ invoices });
  } catch (error) {
    console.error("Fetch Monthly Error:", error);
    res.status(500).json({ message: "Error fetching monthly invoices" });
  }
});

module.exports = router;
