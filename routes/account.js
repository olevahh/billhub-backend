const express = require("express");
const router = express.Router();
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

// JWT auth middleware
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token provided" });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ message: "Invalid token" });
    req.userId = decoded.id;
    next();
  });
};

// GET user profile
router.get("/", verifyToken, async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute(
      "SELECT id, name, email, address, postcode FROM users WHERE id = ?",
      [req.userId]
    );
    await connection.end();
    if (rows.length === 0) return res.status(404).json({ message: "User not found" });
    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching account info" });
  }
});

// PUT user profile
router.put("/", verifyToken, async (req, res) => {
  const { name, email, address, postcode } = req.body;
  try {
    const connection = await mysql.createConnection(dbConfig);
    await connection.execute(
      "UPDATE users SET name = ?, email = ?, address = ?, postcode = ? WHERE id = ?",
      [name, email, address, postcode, req.userId]
    );
    await connection.end();
    res.json({ message: "Account updated successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error updating account info" });
  }
});

module.exports = router;
