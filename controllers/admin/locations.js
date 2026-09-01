// controllers/admin/locations.js
const { formatDateId } = require("../../helper-function/format-date");
const locationModel = require("../../models/location");
const machineModel = require("../../models/machine");

const { clean, toNonNegInt: toInt } = require("../../helper-function/http");

async function newParentWouldCycle(locationId, newParentId) {
  if (!newParentId) return false;
  let cur = Number(newParentId);
  const self = Number(locationId);
  let steps = 0;
  while (cur && steps++ < 500) {
    if (cur === self) return true;
    const row = await locationModel.findByIdAny(cur);
    if (!row) break;
    cur = row.parent_id != null ? Number(row.parent_id) : null;
  }
  return false;
}

async function resolveParentId(raw) {
  const pid = toInt(raw, 0);
  if (!pid) return { parent_id: null };
  const p = await locationModel.findByIdAny(pid);
  if (!p || p.deleted_at) return { error: "Induk tidak valid atau sudah diarsipkan." };
  if (p.parent_id) return { error: "Sub-lokasi tidak bisa jadi induk. Pilih lokasi master saja." };
  return { parent_id: pid };
}

exports.list = async (req, res, next) => {
  try {
    const archivedOnly = String(req.query.archived || "") === "1";
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(50, Math.max(5, toInt(req.query.limit, 10)));
    const offset = (page - 1) * limit;

    const [total, rows] = await Promise.all([
      locationModel.countAll({ archivedOnly, mastersOnly: true }),
      locationModel.listPaginated({ limit, offset, archivedOnly, mastersOnly: true }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));
    const archQs = archivedOnly ? "&archived=1" : "";

    return res.render("admin/locations/list", {
      title: archivedOnly ? "Lokasi master (arsip)" : "Lokasi master",
      user: req.user,
      queryError: clean(req.query.err) || null,
      rows: rows.map((r) => ({
        ...r,
        created_at: formatDateId(r.created_at),
        updated_at: formatDateId(r.updated_at),
      })),
      page,
      limit,
      total,
      totalPages,
      archivedOnly,
      archQs,
    });
  } catch (err) {
    return next(err);
  }
};

exports.detail = async (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

    const master = await locationModel.findByIdAny(id);
    if (!master) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

    if (master.parent_id) {
      const errQ = clean(req.query.err);
      const suffix = errQ ? `?err=${encodeURIComponent(errQ)}` : "";
      return res.redirect(`/admin/locations/${master.parent_id}${suffix}`);
    }

    const isArchived = Boolean(master.deleted_at);
    const subsRaw = await locationModel.listSubsByParentId(id, { archivedOnly: isArchived });
    const subs = subsRaw.map((r) => ({
      ...r,
      created_at: formatDateId(r.created_at),
      updated_at: formatDateId(r.updated_at),
    }));

    return res.render("admin/locations/detail", {
      title: `Lokasi: ${master.name}`,
      user: req.user,
      master: {
        ...master,
        created_at: formatDateId(master.created_at),
        updated_at: formatDateId(master.updated_at),
      },
      subs,
      isArchived,
      queryError: clean(req.query.err) || null,
    });
  } catch (err) {
    return next(err);
  }
};

exports.renderNew = async (req, res, next) => {
  try {
    const qParent = toInt(req.query.parent_id, 0);
    let presetParent = "";
    if (qParent) {
      const p = await locationModel.findByIdAny(qParent);
      if (p && !p.deleted_at && !p.parent_id) {
        presetParent = String(qParent);
      }
    }
    const isSubFlow = Boolean(presetParent);
    const masters = isSubFlow ? await locationModel.listMastersForSelect() : [];
    return res.render("admin/locations/new", {
      title: isSubFlow ? "Tambah sub-lokasi" : "Tambah lokasi master",
      user: req.user,
      error: null,
      masters,
      isSubFlow,
      presetMasterName: isSubFlow ? (masters.find((m) => String(m.id) === presetParent)?.name || "") : "",
      value: { name: "", address: "", notes: "", is_active: 1, parent_id: presetParent },
    });
  } catch (err) {
    return next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const name = clean(req.body.name);
    const address = clean(req.body.address) || null;
    const notes = clean(req.body.notes) || null;
    const is_active = req.body.is_active === "0" ? 0 : 1;

    const isSubFlow = String(req.body.sub_flow || "") === "1";
    const bodyParent = String(req.body.parent_id || "").trim();

    const masters = isSubFlow ? await locationModel.listMastersForSelect() : [];
    const presetMasterName = isSubFlow
      ? masters.find((m) => String(m.id) === bodyParent)?.name || ""
      : "";

    const baseLocals = {
      title: isSubFlow ? "Tambah sub-lokasi" : "Tambah lokasi master",
      user: req.user,
      masters,
      isSubFlow,
      presetMasterName,
      value: {
        name,
        address: address || "",
        notes: notes || "",
        is_active,
        parent_id: bodyParent,
      },
    };

    if (!name) {
      return res.status(400).render("admin/locations/new", {
        ...baseLocals,
        error: "Nama lokasi wajib diisi.",
      });
    }

    let parent_id = null;
    if (isSubFlow) {
      const parentRes = await resolveParentId(req.body.parent_id);
      if (parentRes.error) {
        return res.status(400).render("admin/locations/new", {
          ...baseLocals,
          error: parentRes.error,
        });
      }
      parent_id = parentRes.parent_id;
    }

    const existing = await locationModel.findDuplicateName(name, parent_id);
    if (existing) {
      return res.status(409).render("admin/locations/new", {
        ...baseLocals,
        error: "Nama lokasi sudah dipakai di level ini. Gunakan nama lain.",
      });
    }

    await locationModel.create({ name, address, notes, is_active, parent_id });
    if (parent_id) {
      return res.redirect(`/admin/locations/${parent_id}`);
    }
    return res.redirect("/admin/locations");
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      const sub = String(req.body.sub_flow || "") === "1";
      const masters = sub ? await locationModel.listMastersForSelect() : [];
      const bp = String(req.body.parent_id || "").trim();
      return res.status(409).render("admin/locations/new", {
        title: sub ? "Tambah sub-lokasi" : "Tambah lokasi master",
        user: req.user,
        masters,
        isSubFlow: sub,
        presetMasterName: sub ? masters.find((m) => String(m.id) === bp)?.name || "" : "",
        error: "Nama lokasi bentrok di database.",
        value: {
          name: clean(req.body.name),
          address: clean(req.body.address),
          notes: clean(req.body.notes),
          is_active: req.body.is_active === "0" ? 0 : 1,
          parent_id: bp,
        },
      });
    }
    return next(err);
  }
};

exports.renderEdit = async (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

    const location = await locationModel.findByIdAny(id);
    if (!location) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

    const isArchived = Boolean(location.deleted_at);
    const masters = await locationModel.listMastersForSelect();
    const childCount = await locationModel.countActiveChildren(id);

    return res.render("admin/locations/edit", {
      title: isArchived ? "Location (Arsip)" : "Edit Location",
      user: req.user,
      error: clean(req.query.err) || null,
      location,
      isArchived,
      masters,
      childCount,
      value: {
        name: location.name || "",
        address: location.address || "",
        notes: location.notes || "",
        is_active: location.is_active ? 1 : 0,
        parent_id: location.parent_id ? String(location.parent_id) : "",
      },
    });
  } catch (err) {
    return next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

    const location = await locationModel.findByIdAny(id);
    if (!location) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });
    if (location.deleted_at) {
      return res.redirect("/admin/locations?archived=1");
    }

    const name = clean(req.body.name);
    const address = clean(req.body.address) || null;
    const notes = clean(req.body.notes) || null;
    const is_active = req.body.is_active === "0" ? 0 : 1;

    const masters = await locationModel.listMastersForSelect();
    const childCount = await locationModel.countActiveChildren(id);

    const renderErr = async (status, error, valueOverrides = {}) => {
      return res.status(status).render("admin/locations/edit", {
        title: "Edit Location",
        user: req.user,
        error,
        location,
        isArchived: false,
        masters,
        childCount,
        value: {
          name: valueOverrides.name ?? name,
          address: valueOverrides.address ?? (address || ""),
          notes: valueOverrides.notes ?? (notes || ""),
          is_active: valueOverrides.is_active ?? is_active,
          parent_id: valueOverrides.parent_id ?? String(req.body.parent_id || "").trim(),
        },
      });
    };

    if (!name) {
      return renderErr(400, "Nama lokasi wajib diisi.");
    }

    const parentRes = await resolveParentId(req.body.parent_id);
    if (parentRes.error) {
      return renderErr(400, parentRes.error);
    }
    let parent_id = parentRes.parent_id;

    if (parent_id === id) {
      return renderErr(400, "Lokasi tidak boleh jadi induk dirinya sendiri.");
    }

    if (await newParentWouldCycle(id, parent_id)) {
      return renderErr(400, "Struktur induk tidak valid (akan membuat siklus).");
    }

    if (!location.parent_id && parent_id && childCount > 0) {
      return renderErr(
        400,
        "Lokasi master masih punya sub-lokasi aktif. Hapus atau ubah sub-nya dulu sebelum menjadikan ini sub-lokasi."
      );
    }

    if (name !== location.name || Number(location.parent_id || 0) !== Number(parent_id || 0)) {
      const existing = await locationModel.findDuplicateName(name, parent_id);
      if (existing && Number(existing.id) !== Number(id)) {
        return renderErr(409, "Nama lokasi sudah dipakai di level ini. Gunakan nama lain.");
      }
    }

    const ok = await locationModel.updateById({ id, name, address, notes, is_active, parent_id });
    if (!ok) {
      return res.redirect("/admin/locations");
    }
    if (location.parent_id) {
      return res.redirect(`/admin/locations/${location.parent_id}`);
    }
    return res.redirect(`/admin/locations/${id}`);
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      const eid = toInt(req.params.id, 0);
      const [masters, locRow, childCount] = await Promise.all([
        locationModel.listMastersForSelect(),
        locationModel.findByIdAny(eid),
        locationModel.countActiveChildren(eid),
      ]);
      return res.status(409).render("admin/locations/edit", {
        title: "Edit Location",
        user: req.user,
        error: "Nama lokasi bentrok di database.",
        location: locRow || { id: eid },
        isArchived: false,
        masters,
        childCount,
        value: {
          name: clean(req.body.name),
          address: clean(req.body.address),
          notes: clean(req.body.notes),
          is_active: req.body.is_active === "0" ? 0 : 1,
          parent_id: String(req.body.parent_id || "").trim(),
        },
      });
    }
    return next(err);
  }
};

exports.softDelete = async (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(404).render("errors/404", { title: "Not Found" });

    const row = await locationModel.findByIdAny(id);
    if (!row) return res.status(404).render("errors/404", { title: "Not Found" });
    if (row.deleted_at) {
      return res.redirect("/admin/locations?archived=1");
    }

    const [children, machines] = await Promise.all([
      locationModel.countActiveChildren(id),
      machineModel.countByLocationId(id),
    ]);

    if (children > 0) {
      return res.redirect(`/admin/locations/${id}?err=${encodeURIComponent("Masih ada sub-lokasi aktif — hapus atau pindahkan dulu.")}`);
    }
    if (machines > 0) {
      return res.redirect(`/admin/locations/${id}?err=${encodeURIComponent("Masih ada mesin di lokasi ini — pindahkan mesin dulu.")}`);
    }

    await locationModel.softDeleteById(id);
    if (row.parent_id) {
      return res.redirect(`/admin/locations/${row.parent_id}`);
    }
    return res.redirect("/admin/locations");
  } catch (err) {
    return next(err);
  }
};

exports.restore = async (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(404).render("errors/404", { title: "Not Found" });

    const row = await locationModel.findByIdAny(id);
    if (!row) return res.status(404).render("errors/404", { title: "Not Found" });
    if (!row.deleted_at) {
      return res.redirect(row.parent_id ? `/admin/locations/${row.parent_id}` : `/admin/locations/${id}`);
    }

    if (row.parent_id) {
      const parent = await locationModel.findByIdAny(row.parent_id);
      if (!parent || parent.deleted_at) {
        return res.redirect(`/admin/locations?archived=1&err=${encodeURIComponent("Induk masih diarsipkan — pulihkan master dulu.")}`);
      }
    }

    await locationModel.restoreById(id);
    if (row.parent_id) {
      return res.redirect(`/admin/locations/${row.parent_id}`);
    }
    return res.redirect("/admin/locations");
  } catch (err) {
    return next(err);
  }
};
