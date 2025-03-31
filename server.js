const express = require("express");
const cors = require("cors");
const path = require("path");
const app = express();
require("dotenv").config();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
const authRoutes = require("./routes/auth");
const invoiceRoutes = require("./routes/invoices");
const accountRoutes = require("./routes/account");

app.use("/api/auth", authRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/account", accountRoutes);

// Uploads folder (for PDF invoice uploads)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Root test route
app.get("/", (req, res) => {
  res.send("Billhub Backend API is running");
});

// Required for Render to bind to provided PORT
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
