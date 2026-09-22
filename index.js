require("dotenv").config();

const { assertSecurityConfig } = require("./helper-function/security-config");
assertSecurityConfig();

const { resolveListenHost, listenHostWarning } = require("./helper-function/app-http");
const { createApp } = require("./app");

const app = createApp({ skipTimers: false });

const PORT = Number(process.env.PORT || 3000);
const LISTEN_HOST = resolveListenHost();
const listenWarn = listenHostWarning(LISTEN_HOST);
if (listenWarn) console.warn(listenWarn);

if (require.main === module) {
  const server = app.listen(PORT, LISTEN_HOST, () => {
    console.log(`Samakan Core running on ${LISTEN_HOST}:${PORT}`);
  });

  server.on("error", (err) => {
    console.error("[listen]", err.message);
    process.exit(1);
  });
}

module.exports = app;
