const router = require("express").Router();
const { requireAuth, requireRole } = require("../../middleware/auth");

// Kesehatan hardware sekarang bagian dari Machines; URL lama tetap diarahkan.
router.use(requireAuth, requireRole("admin", "staff"));

router.get("/", (req, res) => res.redirect(302, "/admin/machines?health=critical"));
router.get("/machines/:id", (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.redirect(302, "/admin/machines");
  return res.redirect(302, `/admin/machines/${id}/detail#kesehatan`);
});

module.exports = router;
