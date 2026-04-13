require("dotenv").config();
const express = require("express");
const app = express();
const cookieParser = require("cookie-parser");
const cors = require("cors");
require("./cronjob/emailWorker");
app.use(
  cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  })
);

app.use(cookieParser());
app.use(express.json());

const apiRoutes = require("./routes/api");

app.use("/api", apiRoutes);
app.use("/", apiRoutes);

app.get("/", (req, res) => {
  res.send("Smart Blood Donation API running...");
});

const PORT = process.env.APP_PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
