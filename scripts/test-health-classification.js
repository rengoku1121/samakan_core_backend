/**
 * Tes unit health classification — tanpa database.
 */
const { classifyDiagnostics, summarize, validatePayload, normalizeSource, VMC_MODES } =
  require("../helper-function/health-classification");

let pass = 0;
let fail = 0;

function assert(name, cond) {
  if (!cond) {
    console.error(`FAIL: ${name}`);
    fail++;
  } else {
    pass++;
  }
}

// classifyDiagnostics
{
  assert("healthy when all ok",
    classifyDiagnostics({ doorClose: { ok: true }, temperature: { ok: true } }) === "healthy"
  );

  assert("warning on temperature fail",
    classifyDiagnostics({ temperature: { ok: false } }) === "warning"
  );

  assert("warning on dropSensor fail",
    classifyDiagnostics({ dropSensor: { ok: false } }) === "warning"
  );

  assert("warning on dropSensitivity fail",
    classifyDiagnostics({ dropSensitivity: { ok: false } }) === "warning"
  );

  assert("warning on tempConnection fail",
    classifyDiagnostics({ tempConnection: { ok: false } }) === "warning"
  );

  assert("warning on jammedSelections fail",
    classifyDiagnostics({ jammedSelections: { ok: false } }) === "warning"
  );

  assert("warning on sensorStatus fail",
    classifyDiagnostics({ sensorStatus: { ok: false } }) === "warning"
  );

  assert("critical on motorErrors fail",
    classifyDiagnostics({ motorErrors: { ok: false } }) === "critical"
  );

  assert("critical on liftErrors fail",
    classifyDiagnostics({ liftErrors: { ok: false } }) === "critical"
  );

  assert("critical on liftConnection fail",
    classifyDiagnostics({ liftConnection: { ok: false } }) === "critical"
  );

  assert("critical on quarterTurnErrors fail",
    classifyDiagnostics({ quarterTurnErrors: { ok: false } }) === "critical"
  );

  assert("critical overrides warning",
    classifyDiagnostics({ temperature: { ok: false }, motorErrors: { ok: false } }) === "critical"
  );

  assert("critical on UART via meta",
    classifyDiagnostics({ doorClose: { ok: true } }, { uart_connected: false }) === "critical"
  );

  assert("healthy with empty object",
    classifyDiagnostics({}) === "healthy"
  );
}

// summarize — signature: (diagnostics, overallStatus, meta)
{
  const s1 = summarize({ doorClose: { ok: true } }, "healthy");
  assert("summarize healthy", s1.includes("normal"));

  const s2 = summarize({ motorErrors: { ok: false, error: "motor stuck" } }, "critical");
  assert("summarize critical includes error", s2.includes("motor"));
}

// validatePayload — returns null on success, string on error
{
  assert("valid payload passes", validatePayload({ diagnostics: { doorClose: { ok: true } } }) === null);
  assert("null payload fails", validatePayload(null) !== null);
  assert("string payload fails", validatePayload("hello") !== null);
  assert("missing diagnostics fails", validatePayload({}) !== null);

  const big = {};
  for (let i = 0; i < 50; i++) big[`key${i}`] = { ok: true };
  assert("too many keys fails", validatePayload({ diagnostics: big }) !== null);

  assert("unknown key fails", validatePayload({ diagnostics: { bogusId: { ok: true } } }) !== null);
}

// normalizeSource
{
  assert("periodic source passes", normalizeSource("periodic") === "periodic");
  assert("dispense source passes", normalizeSource("dispense") === "dispense");
  assert("manual source passes", normalizeSource("manual") === "manual");
  assert("unknown source defaults", normalizeSource("bogus") === "periodic");
  assert("undefined source defaults", normalizeSource(undefined) === "periodic");
}

// VMC_MODES
{
  assert("hardware mode valid", VMC_MODES.has("hardware"));
  assert("loopback-sim mode valid", VMC_MODES.has("loopback-sim"));
  assert("mock mode not reported", !VMC_MODES.has("mock"));
  assert("vmc_mode does not break payload validation",
    validatePayload({ diagnostics: { doorClose: { ok: true } }, vmc_mode: "loopback-sim" }) === null
  );
}

// reportFingerprint — nilai angka dan link_stats tidak mengubah sidik
{
  const { reportFingerprint } = require("../helper-function/health-classification");
  const meta = { overall_status: "healthy", uart_connected: true, vmc_mode: "hardware" };
  const warm = { temperature: { ok: true, values: { celsius: 5 } }, doorClose: { ok: true } };
  const warmer = { doorClose: { ok: true }, temperature: { ok: true, values: { celsius: 6 } } };
  assert("sidik stabil walau suhu berubah", reportFingerprint(warm, meta) === reportFingerprint(warmer, meta));
  const flipped = { doorClose: { ok: true }, temperature: { ok: true, values: { celsius: 5 } } };
  assert("urutan diagnostik tidak berpengaruh", reportFingerprint(warm, meta) === reportFingerprint(flipped, meta));

  const tempFail = { temperature: { ok: false, error: "5C" }, doorClose: { ok: true } };
  const tempFailOther = { doorClose: { ok: true }, temperature: { ok: false, values: { celsius: 9 }, error: "9C" } };
  const jammed = { temperature: { ok: true }, jammedSelections: { ok: false, error: "slot" } };
  assert("id gagal yang sama tetap satu sidik", reportFingerprint(tempFail, meta) === reportFingerprint(tempFailOther, meta));
  assert("id gagal berbeda mengubah sidik", reportFingerprint(tempFail, meta) !== reportFingerprint(jammed, meta));
  assert("vmc_mode membedakan sidik",
    reportFingerprint(warm, meta) !== reportFingerprint(warm, { ...meta, vmc_mode: "loopback-sim" })
  );
  assert("UART membedakan sidik",
    reportFingerprint(warm, meta) !== reportFingerprint(warm, { ...meta, uart_connected: false })
  );
  assert("link_stats tidak masuk sidik",
    reportFingerprint(warm, { ...meta, link_stats: { resend_count: 4 } }) ===
      reportFingerprint(warm, { ...meta, link_stats: { resend_count: 0 } })
  );
  assert("sidik sha1 40 karakter", reportFingerprint(warm, meta).length === 40);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log("PASS: health-classification");
