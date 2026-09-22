const { eq, ok, request, login, PASSWORD, TAG } = require("./helpers");

module.exports = async function run(ctx) {
  const admin = await login(ctx, `${TAG}-admin`, PASSWORD);

  const noAuth = await request(ctx, "GET", "/admin/xy");
  ok("xy tanpa cookie", noAuth.status === 302, noAuth.status);

  const page = await request(ctx, "GET", "/admin/xy", { jar: admin.jar });
  eq("GET /admin/xy", page.status, 200);
  const machines = await request(ctx, "GET", "/admin/xy/machines", { jar: admin.jar, accept: "application/json" });
  eq("xy machines", machines.status, 200);
  ok("xy stub json", machines.json && machines.json.ok === true, machines.json);

  const state = await request(ctx, "GET", "/admin/xy/machines/e2e-jqbh/state", {
    jar: admin.jar,
    accept: "application/json",
  });
  eq("xy state", state.status, 200);
  const slots = await request(ctx, "GET", "/admin/xy/machines/e2e-jqbh/slots", {
    jar: admin.jar,
    accept: "application/json",
  });
  eq("xy slots", slots.status, 200);
  const plus = await request(ctx, "GET", "/admin/xy/machines/e2e-jqbh/slots-plus", {
    jar: admin.jar,
    accept: "application/json",
  });
  eq("xy slots-plus", plus.status, 200);
  const products = await request(ctx, "GET", "/admin/xy/products", { jar: admin.jar, accept: "application/json" });
  eq("xy products", products.status, 200);
};
