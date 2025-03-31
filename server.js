const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const authRoutes = require("./routes/auth");
const invoiceRoutes = require("./routes/invoices");
const accountRoutes = require("./routes/account");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api/auth", authRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/account", accountRoutes);

// Stripe checkout route
app.post("/api/create-checkout-session", async (req, res) => {
  const { amount, email } = req.body;
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: "Consolidated Utility Bill",
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL}/payment-success`,
      cancel_url: `${process.env.FRONTEND_URL}/payment-cancelled`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe session error:", err);
    res.status(500).json({ message: "Stripe checkout failed" });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
