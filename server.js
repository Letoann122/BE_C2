require("dotenv").config();

const express = require("express");
const http = require("http");

const cookieParser = require("cookie-parser");
const cors = require("cors");

const { initSocket } = require("./socket");

require("./cronjob/emailWorker");

const app = express();

/*
|--------------------------------------------------------------------------
| CORS
|--------------------------------------------------------------------------
*/
app.use(
  cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  })
);

/*
|--------------------------------------------------------------------------
| Middlewares
|--------------------------------------------------------------------------
*/
app.use(cookieParser());
app.use(express.json());

/*
|--------------------------------------------------------------------------
| Routes
|--------------------------------------------------------------------------
*/
const apiRoutes = require("./routes/api");

app.use("/api", apiRoutes);
app.use("/", apiRoutes);

/*
|--------------------------------------------------------------------------
| Health Check
|--------------------------------------------------------------------------
*/
app.get("/", (req, res) => {
  res.send("Smart Blood Donation API running...");
});

/*
|--------------------------------------------------------------------------
| Create HTTP Server
|--------------------------------------------------------------------------
*/
const server = http.createServer(app);

/*
|--------------------------------------------------------------------------
| Init Socket.IO
|--------------------------------------------------------------------------
*/
initSocket(server);

/*
|--------------------------------------------------------------------------
| Start Server
|--------------------------------------------------------------------------
*/
const PORT = process.env.APP_PORT || 4000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});