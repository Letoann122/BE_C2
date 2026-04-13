// config/mailer.js
const nodemailer = require("nodemailer");
// LẤY default ra
const { default: hbs } = require("nodemailer-express-handlebars");
const path = require("path");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

transporter.use(
  "compile",
  hbs({
    viewEngine: {
      extname: ".html",                        // đuôi file template
      partialsDir: path.resolve("./mail_templates"),
      layoutsDir: path.resolve("./mail_templates"),
      defaultLayout: false,
    },
    viewPath: path.resolve("./mail_templates"),
    extName: ".html",                          // đuôi file template
  })
);

module.exports = transporter;
