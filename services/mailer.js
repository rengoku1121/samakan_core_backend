/**
 * Kirim kode OTP. SMTP untuk production.
 * MAIL_SINK=memory menahan surat di proses ini (pengembangan dan E2E).
 */
const inbox = [];

function memorySink() {
  return String(process.env.MAIL_SINK || "").trim() === "memory";
}

function smtpConfigured() {
  return Boolean(String(process.env.SMTP_HOST || "").trim());
}

function remember(message) {
  inbox.push(message);
  if (inbox.length > 50) inbox.shift();
}

async function sendLoginOtp({ to, code }) {
  const message = {
    to: String(to || ""),
    subject: "Kode masuk Samakan",
    text: `Kode masuk Samakan: ${code}. Berlaku 10 menit.`,
    code: String(code),
  };
  if (memorySink() || (!smtpConfigured() && process.env.NODE_ENV !== "production")) {
    remember(message);
    if (!memorySink()) console.log(`[mail] OTP untuk ${message.to}: ${message.code}`);
    return { sent: true, sink: "memory" };
  }
  if (!smtpConfigured()) return { sent: false, reason: "smtp-missing" };

  const nodemailer = require("nodemailer");
  const port = Number(process.env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: String(process.env.SMTP_SECURE || "") === "1" || port === 465,
    auth: String(process.env.SMTP_USER || "").trim()
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" }
      : undefined,
  });
  await transport.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
  return { sent: true };
}

function takeLastCode(to) {
  const want = String(to || "");
  for (let i = inbox.length - 1; i >= 0; i -= 1) {
    if (!want || inbox[i].to === want) return inbox[i].code;
  }
  return "";
}

module.exports = {
  sendLoginOtp,
  takeLastCode,
  memorySink,
  smtpConfigured,
};
