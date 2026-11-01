/**
 * Tes unit RBAC dan panel-account untuk role technician — tanpa database.
 */
const { roleAllowed, canEditMoneySettings } = require("../helper-function/rbac");
const { panelRole, accountFieldError } = require("../helper-function/panel-account");

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

// roleAllowed
{
  assert("technician allowed for technician route",
    roleAllowed({ role: "technician" }, ["technician"])
  );

  assert("technician NOT allowed for admin route",
    !roleAllowed({ role: "technician" }, ["admin"])
  );

  assert("technician NOT allowed for staff route",
    !roleAllowed({ role: "technician" }, ["staff"])
  );

  assert("admin NOT allowed for technician route",
    !roleAllowed({ role: "admin" }, ["technician"])
  );

  assert("superadmin bypasses admin route",
    roleAllowed({ role: "superadmin" }, ["admin"])
  );

  assert("superadmin bypasses staff route",
    roleAllowed({ role: "superadmin" }, ["staff"])
  );

  assert("superadmin does NOT bypass technician route",
    !roleAllowed({ role: "superadmin" }, ["technician"])
  );
}

// canEditMoneySettings
{
  assert("technician cannot edit money",
    !canEditMoneySettings({ role: "technician" })
  );

  assert("admin can edit money",
    canEditMoneySettings({ role: "admin" })
  );
}

// panelRole
{
  assert("technician is valid panel role",
    panelRole("technician") === "technician"
  );

  assert("admin is valid panel role",
    panelRole("admin") === "admin"
  );

  assert("staff is valid panel role",
    panelRole("staff") === "staff"
  );

  assert("superadmin is NOT panel role",
    panelRole("superadmin") === null
  );

  assert("merchant is NOT panel role",
    panelRole("merchant") === null
  );
}

// accountFieldError with technician
{
  const noError = accountFieldError({
    username: "teknisi.satu",
    email: "teknisi@samakan.id",
    role: "technician",
    password: "password123",
    passwordConfirm: "password123",
    passwordRequired: true,
  });
  assert("technician field validation passes", noError === null);

  const badRole = accountFieldError({
    username: "teknisi.satu",
    email: "teknisi@samakan.id",
    role: "superadmin",
    password: "password123",
    passwordConfirm: "password123",
    passwordRequired: true,
  });
  assert("superadmin rejected by field validation", badRole !== null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log("PASS: health-rbac");
