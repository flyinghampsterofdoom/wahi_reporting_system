function byId(id) {
  return document.getElementById(id);
}

const toast = byId("toast");

function showToast(message, isError = false) {
  if (!toast) return;
  toast.textContent = message;
  toast.style.background = isError ? "#c62828" : "#2e7d32";
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}

function parseNullableNumber(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed === "") return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

function computePurchaseBreakdown(caseSize, purchaseUnit, purchaseCost, trackedVolumeMl) {
  if (purchaseCost === null || purchaseCost === undefined) return null;
  let perBottle = Number(purchaseCost);
  if (purchaseUnit === "CASE") {
    if (!Number(caseSize)) return null;
    perBottle = Number(purchaseCost) / Number(caseSize);
  }
  if (!Number.isFinite(perBottle) || perBottle < 0) return null;
  const perMl = Number(trackedVolumeMl) > 0 ? perBottle / Number(trackedVolumeMl) : null;
  return {
    perBottle: Number(perBottle.toFixed(4)),
    perMl: perMl === null ? null : Number(perMl.toFixed(6)),
  };
}

function trackedVolumeFromRows(container) {
  const tracked = [...container.querySelectorAll(".size-row")].find(
    (row) => row.querySelector(".size-tracked")?.checked
  );
  if (!tracked) return null;
  const vol = Number(tracked.querySelector(".size-volume")?.value);
  return Number.isFinite(vol) && vol > 0 ? vol : null;
}

function renderCostPreview(previewNode, caseSize, purchaseUnit, purchaseCost, trackedVolumeMl) {
  if (!previewNode) return;
  if (purchaseCost === null || purchaseCost === undefined) {
    previewNode.textContent = "Item Cost not set. Tracked size cost/ml will use manual bottle cost.";
    return;
  }
  const breakdown = computePurchaseBreakdown(caseSize, purchaseUnit, purchaseCost, trackedVolumeMl);
  if (!breakdown) {
    previewNode.textContent = "Enter valid case size and tracked volume to calculate cost per bottle and per ml.";
    return;
  }
  const sourceLabel = purchaseUnit === "CASE" ? "case" : "bottle";
  const perMlText = breakdown.perMl === null ? "n/a" : `$${breakdown.perMl.toFixed(6)} / ml`;
  previewNode.textContent = `From $${Number(purchaseCost).toFixed(2)} per ${sourceLabel}: $${breakdown.perBottle.toFixed(4)} per tracked bottle, ${perMlText}.`;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Request failed");
  }

  if (response.status === 204) return null;
  return response.json();
}

function addSizeRow(
  sizeRowsContainer,
  defaults = { id: null, sizeLabel: "", volumeMl: 750, unitCost: null, isTracked: false },
  trackGroup = `${sizeRowsContainer.id}-track`
) {
  const row = document.createElement("div");
  row.className = "size-row";
  row.innerHTML = `
    <input type="hidden" class="size-id" value="${defaults.id ?? ""}" />
    <label>Label <input type="text" class="size-label" value="${defaults.sizeLabel}" placeholder="750ml" required /></label>
    <label>Volume ml <input type="number" class="size-volume" min="1" value="${defaults.volumeMl}" required /></label>
    <label>Cost / Bottle <input type="number" class="size-cost" min="0" step="0.01" value="${defaults.unitCost ?? ""}" placeholder="optional" /></label>
    <label class="track-label">Track Item Size <input type="radio" class="size-tracked" name="${trackGroup}" ${defaults.isTracked ? "checked" : ""} /></label>
    <button type="button" class="secondary remove-size">Remove</button>
  `;
  row.querySelector(".remove-size").addEventListener("click", () => {
    row.remove();
    sizeRowsContainer.dispatchEvent(new Event("change"));
  });
  sizeRowsContainer.appendChild(row);
}

function ensureTrackedSelection(container) {
  const radios = [...container.querySelectorAll(".size-tracked")];
  if (!radios.length) return false;
  if (!radios.some((r) => r.checked)) radios[0].checked = true;
  return true;
}

function collectSizesFrom(container) {
  ensureTrackedSelection(container);

  return [...container.querySelectorAll(".size-row")].map((row) => {
    const idValue = row.querySelector(".size-id")?.value || "";
    const payload = {
      sizeLabel: row.querySelector(".size-label").value.trim(),
      volumeMl: Number(row.querySelector(".size-volume").value),
      unitCost: parseNullableNumber(row.querySelector(".size-cost").value),
      isTracked: row.querySelector(".size-tracked")?.checked || false,
    };
    if (idValue) payload.id = Number(idValue);
    return payload;
  });
}

function setAreaToggleState(activeArea, buttons) {
  buttons.forEach(({ area, button }) => {
    if (!button) return;
    if (area === activeArea) {
      button.classList.add("toggle-active");
      button.classList.remove("secondary");
    } else {
      button.classList.remove("toggle-active");
      button.classList.add("secondary");
    }
  });
}

async function initVendorPage() {
  const vendorForm = byId("vendor-form");
  const vendorNameInput = byId("vendor-name");
  if (!vendorForm || !vendorNameInput) return;

  const vendorAddressInput = byId("vendor-address");
  const vendorEmailInput = byId("vendor-email");
  const vendorCorporateNumberInput = byId("vendor-corporate-number");
  const vendorRepresentativeNameInput = byId("vendor-representative-name");
  const vendorRepresentativePhoneInput = byId("vendor-representative-phone");
  const vendorRepresentativeEmailInput = byId("vendor-representative-email");

  vendorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/vendors", {
        method: "POST",
        body: JSON.stringify({
          name: vendorNameInput.value.trim(),
          address: vendorAddressInput?.value?.trim() || "",
          email: vendorEmailInput?.value?.trim() || "",
          corporateNumber: vendorCorporateNumberInput?.value?.trim() || "",
          representativeName: vendorRepresentativeNameInput?.value?.trim() || "",
          representativePhone: vendorRepresentativePhoneInput?.value?.trim() || "",
          representativeEmail: vendorRepresentativeEmailInput?.value?.trim() || "",
        }),
      });
      vendorForm.reset();
      showToast("Vendor added and saved.");
      window.dispatchEvent(new CustomEvent("catalog-data-changed"));
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

async function initAddItemPage() {
  const itemForm = byId("item-form");
  if (!itemForm) return;

  const itemNameInput = byId("item-name");
  const itemVendorSelect = byId("item-vendor");
  const itemCaseSizeInput = byId("item-case-size");
  const itemAreaTypeSelect = byId("item-area-type");
  const itemPurchaseUnit = byId("item-purchase-unit");
  const itemPurchaseCost = byId("item-purchase-cost");
  const itemCostPreview = byId("item-cost-preview");
  const sizeRowsContainer = byId("size-rows");
  const addSizeRowButton = byId("add-size-row");

  function refreshAddPreview() {
    renderCostPreview(
      itemCostPreview,
      Number(itemCaseSizeInput.value),
      itemPurchaseUnit.value,
      parseNullableNumber(itemPurchaseCost.value),
      trackedVolumeFromRows(sizeRowsContainer)
    );
  }

  async function loadVendors() {
    const vendors = await api("/api/vendors");
    if (!vendors.length) {
      itemVendorSelect.innerHTML = `<option value="">Add a vendor first</option>`;
      itemVendorSelect.disabled = true;
      return;
    }

    itemVendorSelect.disabled = false;
    itemVendorSelect.innerHTML = vendors.map((v) => `<option value="${v.id}">${v.name}</option>`).join("");
  }

  itemForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      if (itemVendorSelect.disabled) {
        showToast("Add a vendor first.", true);
        return;
      }

      await api("/api/items", {
        method: "POST",
        body: JSON.stringify({
          name: itemNameInput.value.trim(),
          vendorId: Number(itemVendorSelect.value),
          caseSize: Number(itemCaseSizeInput.value),
          areaType: itemAreaTypeSelect.value,
          purchaseUnit: itemPurchaseUnit.value,
          purchaseCost: parseNullableNumber(itemPurchaseCost.value),
          sizes: collectSizesFrom(sizeRowsContainer),
        }),
      });

      itemNameInput.value = "";
      itemCaseSizeInput.value = 12;
      itemAreaTypeSelect.value = "FOH";
      itemPurchaseUnit.value = "BOTTLE";
      itemPurchaseCost.value = "";
      sizeRowsContainer.innerHTML = "";
      addSizeRow(sizeRowsContainer, { sizeLabel: "1L", volumeMl: 1000, isTracked: true });
      addSizeRow(sizeRowsContainer, { sizeLabel: "750ml", volumeMl: 750, isTracked: false });
      refreshAddPreview();
      showToast("Item created and saved.");
      window.dispatchEvent(new CustomEvent("catalog-data-changed"));
    } catch (error) {
      showToast(error.message, true);
    }
  });

  addSizeRowButton.addEventListener("click", () => {
    addSizeRow(sizeRowsContainer);
    refreshAddPreview();
  });
  sizeRowsContainer.addEventListener("input", refreshAddPreview);
  sizeRowsContainer.addEventListener("change", refreshAddPreview);
  itemCaseSizeInput.addEventListener("input", refreshAddPreview);
  itemPurchaseUnit.addEventListener("change", refreshAddPreview);
  itemPurchaseCost.addEventListener("input", refreshAddPreview);
  addSizeRow(sizeRowsContainer, { sizeLabel: "1L", volumeMl: 1000, isTracked: true });
  addSizeRow(sizeRowsContainer, { sizeLabel: "750ml", volumeMl: 750, isTracked: false });
  refreshAddPreview();
  await loadVendors();
}

async function initItemCatalogPage() {
  const catalogList = byId("catalog-list");
  if (!catalogList) return;

  const sortBySelect = byId("catalog-sort-by");
  const sortDirectionSelect = byId("catalog-sort-direction");
  const filterVendorSelect = byId("catalog-filter-vendor");
  const filterAreaSelect = byId("catalog-filter-area");
  const filterNameInput = byId("catalog-filter-name");
  const refreshButton = byId("refresh-catalog");
  const openAddItemButton = byId("open-add-item");
  const addItemSection = byId("add-item-section");
  const editSection = byId("edit-item-section");
  const editForm = byId("edit-item-form");
  const cancelEditButton = byId("cancel-edit");
  const editAddSizeRowButton = byId("edit-add-size-row");
  const editSizeRows = byId("edit-size-rows");
  const editItemId = byId("edit-item-id");
  const editItemName = byId("edit-item-name");
  const editItemAreaType = byId("edit-item-area-type");
  const editItemVendor = byId("edit-item-vendor");
  const editItemCaseSize = byId("edit-item-case-size");
  const editItemPurchaseUnit = byId("edit-item-purchase-unit");
  const editItemPurchaseCost = byId("edit-item-purchase-cost");
  const editItemCostPreview = byId("edit-item-cost-preview");

  let vendors = [];
  let items = [];

  function refreshEditPreview() {
    renderCostPreview(
      editItemCostPreview,
      Number(editItemCaseSize.value),
      editItemPurchaseUnit.value,
      parseNullableNumber(editItemPurchaseCost.value),
      trackedVolumeFromRows(editSizeRows)
    );
  }

  function sortItems(inputItems) {
    const key = sortBySelect.value;
    const dir = sortDirectionSelect.value === "desc" ? -1 : 1;

    return [...inputItems].sort((a, b) => {
      let left = "";
      let right = "";

      if (key === "vendor") {
        left = a.vendor.name;
        right = b.vendor.name;
      } else if (key === "areaType") {
        left = a.areaType;
        right = b.areaType;
      } else {
        left = a.name;
        right = b.name;
      }

      const main = left.localeCompare(right);
      if (main !== 0) return main * dir;
      return a.name.localeCompare(b.name) * dir;
    });
  }

  function applyFilters(inputItems) {
    const vendorFilter = filterVendorSelect.value;
    const areaFilter = filterAreaSelect.value;
    const nameFilter = filterNameInput.value.trim().toLowerCase();

    return inputItems.filter((item) => {
      const vendorMatch = !vendorFilter || String(item.vendor.id) === vendorFilter;
      const areaMatch = !areaFilter || item.areaType === areaFilter;
      const nameMatch = !nameFilter || item.name.toLowerCase().includes(nameFilter);
      return vendorMatch && areaMatch && nameMatch;
    });
  }

  function renderCatalog() {
    const filteredItems = applyFilters(items);
    const sortedItems = sortItems(filteredItems);

    if (!sortedItems.length) {
      catalogList.innerHTML = "<p>No items match current filters.</p>";
      return;
    }

    const rows = sortedItems
      .map((item) => {
        const sizes = item.sizes
          .map((s) => {
            const trackControl = s.isTracked
              ? `<span class="track-state">Tracked</span>`
              : `<button class="secondary track-toggle-btn" data-item-id="${item.id}" data-size-id="${s.id}">Set Tracked</button>`;
            const costText =
              s.unitCost === null || s.unitCost === undefined ? "No Cost" : `$${Number(s.unitCost).toFixed(2)}`;

            return `<div class="size-line">${s.sizeLabel} (${s.volumeMl}ml, ${costText}) ${trackControl}</div>`;
          })
          .join("");

        return `
          <tr>
            <td>${item.vendor.name}</td>
            <td>${item.areaType}</td>
            <td>${item.name}</td>
            <td>${item.caseSize}</td>
            <td>${sizes}</td>
            <td><button class="secondary edit-item-btn" data-item-id="${item.id}">Edit Item</button></td>
          </tr>
        `;
      })
      .join("");

    catalogList.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Vendor</th>
            <th>FOH/BOH</th>
            <th>Item Name</th>
            <th>Case Size</th>
            <th>Bottle Sizes</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    catalogList.querySelectorAll(".edit-item-btn").forEach((btn) => {
      btn.addEventListener("click", () => startEdit(Number(btn.dataset.itemId)));
    });

    catalogList.querySelectorAll(".track-toggle-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const itemId = Number(btn.dataset.itemId);
          const itemSizeId = Number(btn.dataset.sizeId);
          await api(`/api/items/${itemId}/tracked-size`, {
            method: "POST",
            body: JSON.stringify({ itemSizeId }),
          });
          await reloadData();
          showToast("Tracked item size updated.");
          window.dispatchEvent(new CustomEvent("catalog-data-changed"));
        } catch (error) {
          showToast(error.message, true);
        }
      });
    });
  }

  function loadVendorOptions(selectNode) {
    selectNode.innerHTML = vendors.map((v) => `<option value="${v.id}">${v.name}</option>`).join("");
  }

  function loadVendorFilterOptions() {
    const currentValue = filterVendorSelect.value;
    const options = vendors
      .map((v) => `<option value="${v.id}">${v.name}</option>`)
      .join("");
    filterVendorSelect.innerHTML = `<option value="">All Vendors</option>${options}`;
    if ([...vendors.map((v) => String(v.id)), ""].includes(currentValue)) {
      filterVendorSelect.value = currentValue;
    }
  }

  function startEdit(itemId) {
    const item = items.find((entry) => entry.id === itemId);
    if (!item) return;

    editItemId.value = String(item.id);
    editItemName.value = item.name;
    editItemAreaType.value = item.areaType;
    editItemCaseSize.value = String(item.caseSize);
    editItemPurchaseUnit.value = item.purchaseUnit || "BOTTLE";
    editItemPurchaseCost.value = item.purchaseCost ?? "";
    loadVendorOptions(editItemVendor);
    editItemVendor.value = String(item.vendor.id);

    editSizeRows.innerHTML = "";
    item.sizes.forEach((size) => addSizeRow(editSizeRows, size, "edit-size-track"));
    refreshEditPreview();

    editSection.hidden = false;
    editSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeEdit() {
    editSection.hidden = true;
    editForm.reset();
    editSizeRows.innerHTML = "";
  }

  async function reloadData() {
    vendors = await api("/api/vendors");
    items = await api("/api/items");
    loadVendorFilterOptions();
    renderCatalog();
  }

  refreshButton.addEventListener("click", () => reloadData().catch((e) => showToast(e.message, true)));
  if (openAddItemButton && addItemSection) {
    openAddItemButton.addEventListener("click", () => {
      addItemSection.hidden = !addItemSection.hidden;
      if (!addItemSection.hidden) {
        addItemSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }
  sortBySelect.addEventListener("change", renderCatalog);
  sortDirectionSelect.addEventListener("change", renderCatalog);
  filterVendorSelect.addEventListener("change", renderCatalog);
  filterAreaSelect.addEventListener("change", renderCatalog);
  filterNameInput.addEventListener("input", renderCatalog);
  cancelEditButton.addEventListener("click", closeEdit);
  editAddSizeRowButton.addEventListener("click", () =>
    addSizeRow(editSizeRows, { sizeLabel: "", volumeMl: 750, unitCost: null, isTracked: false }, "edit-size-track")
  );
  editSizeRows.addEventListener("input", refreshEditPreview);
  editSizeRows.addEventListener("change", refreshEditPreview);
  editItemCaseSize.addEventListener("input", refreshEditPreview);
  editItemPurchaseUnit.addEventListener("change", refreshEditPreview);
  editItemPurchaseCost.addEventListener("input", refreshEditPreview);

  editForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      const id = Number(editItemId.value);
      await api(`/api/items/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: editItemName.value.trim(),
          areaType: editItemAreaType.value,
          vendorId: Number(editItemVendor.value),
          caseSize: Number(editItemCaseSize.value),
          purchaseUnit: editItemPurchaseUnit.value,
          purchaseCost: parseNullableNumber(editItemPurchaseCost.value),
          sizes: collectSizesFrom(editSizeRows),
        }),
      });

      await reloadData();
      closeEdit();
      showToast("Item updated.");
      window.dispatchEvent(new CustomEvent("catalog-data-changed"));
    } catch (error) {
      showToast(error.message, true);
    }
  });

  window.addEventListener("catalog-data-changed", () => {
    reloadData().catch((e) => showToast(e.message, true));
  });

  await reloadData();
}

async function initAreasPage() {
  const areaForm = byId("area-form");
  const areaNameInput = byId("area-name");
  const assignmentForm = byId("area-assignment-form");
  if (!areaForm || !areaNameInput || !assignmentForm) return;

  const assignmentItemSelect = byId("assignment-item");
  const assignmentAreaSelect = byId("assignment-area");
  const areasList = byId("areas-list");
  const assignmentsList = byId("area-assignments-list");

  async function reload() {
    const [items, areas, assignments] = await Promise.all([
      api("/api/items"),
      api("/api/areas"),
      api("/api/item-area-assignments"),
    ]);

    assignmentItemSelect.innerHTML = items
      .map((item) => `<option value="${item.id}">${item.name} (${item.areaType})</option>`)
      .join("");

    assignmentAreaSelect.innerHTML = areas
      .map((area) => `<option value="${area.id}">${area.name}</option>`)
      .join("");

    if (!areas.length) {
      areasList.innerHTML = "<p>No areas created yet.</p>";
    } else {
      areasList.innerHTML = `
        <table>
          <thead><tr><th>Area</th><th>Action</th></tr></thead>
          <tbody>
            ${areas
              .map(
                (area) =>
                  `<tr><td>${area.name}</td><td><button class="secondary delete-area-btn" data-area-id="${area.id}">Delete</button></td></tr>`
              )
              .join("")}
          </tbody>
        </table>
      `;
    }

    if (!assignments.length) {
      assignmentsList.innerHTML = "<p>No assignments yet.</p>";
    } else {
      assignmentsList.innerHTML = `
        <table>
          <thead><tr><th>Item</th><th>FOH/BOH</th><th>Area</th><th>Action</th></tr></thead>
          <tbody>
            ${assignments
              .map(
                (row) =>
                  `<tr><td>${row.item_name}</td><td>${row.area_type}</td><td>${row.area_name}</td><td><button class="secondary unassign-btn" data-item-id="${row.item_id}" data-area-id="${row.area_id}">Remove</button></td></tr>`
              )
              .join("")}
          </tbody>
        </table>
      `;
    }

    areasList.querySelectorAll(".delete-area-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api(`/api/areas/${Number(btn.dataset.areaId)}`, { method: "DELETE" });
          await reload();
          showToast("Area deleted.");
        } catch (error) {
          showToast(error.message, true);
        }
      });
    });

    assignmentsList.querySelectorAll(".unassign-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api("/api/item-area-assignments", {
            method: "DELETE",
            body: JSON.stringify({
              itemId: Number(btn.dataset.itemId),
              areaId: Number(btn.dataset.areaId),
            }),
          });
          await reload();
          showToast("Assignment removed.");
        } catch (error) {
          showToast(error.message, true);
        }
      });
    });
  }

  areaForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/areas", {
        method: "POST",
        body: JSON.stringify({ name: areaNameInput.value.trim() }),
      });
      areaForm.reset();
      await reload();
      showToast("Area added.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  assignmentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/item-area-assignments", {
        method: "POST",
        body: JSON.stringify({
          itemId: Number(assignmentItemSelect.value),
          areaId: Number(assignmentAreaSelect.value),
        }),
      });
      await reload();
      showToast("Area assigned to item.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  await reload();
}

async function initCountsPage() {
  const countDateInput = byId("count-date");
  const countSheet = byId("count-sheet");
  const loadCountSheetButton = byId("load-count-sheet");
  const saveCountsButton = byId("save-counts");
  const fohButton = byId("counts-area-foh");
  const bohButton = byId("counts-area-boh");
  if (!countDateInput || !countSheet || !loadCountSheetButton || !saveCountsButton || !fohButton || !bohButton)
    return;

  let selectedArea = "FOH";

  async function loadCountSheet() {
    const date = countDateInput.value;
    const rows = await api(`/api/counts?date=${date}&area=${selectedArea}`);

    if (!rows.length) {
      countSheet.innerHTML = `<p>No ${selectedArea} items found in catalog.</p>`;
      return;
    }

    const tableRows = rows
      .map((r) => {
        const trackedLabel = r.is_tracked ? "Tracked" : "Untracked";
        const defaultFull = r.is_tracked ? r.full_bottles || 0 : 0;
        const defaultPartial = r.is_tracked ? r.partial_percent || 0 : 0;
        return `
      <tr class="${r.is_tracked ? "tracked-row" : "untracked-row"}">
        <td>${r.item_name}</td>
        <td>${r.size_label} (${r.volume_ml}ml)</td>
        <td>${trackedLabel}</td>
        <td><input type="number" min="0" step="0.1" data-id="${r.size_id}" data-field="full" value="${defaultFull}" /></td>
        <td><input type="number" min="0" max="100" step="1" data-id="${r.size_id}" data-field="partial" value="${defaultPartial}" /></td>
      </tr>
    `;
      })
      .join("");

    countSheet.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Size</th>
            <th>Type</th>
            <th>Full Bottles</th>
            <th>Partial %</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    `;
  }

  async function saveCounts() {
    const date = countDateInput.value;
    const inputs = [...countSheet.querySelectorAll("input[data-id]")];
    const grouped = new Map();

    for (const input of inputs) {
      const id = Number(input.dataset.id);
      if (!grouped.has(id)) grouped.set(id, { full: 0, partial: 0 });
      grouped.get(id)[input.dataset.field] = Number(input.value || 0);
    }

    const writes = [...grouped.entries()].map(([itemSizeId, values]) =>
      api("/api/counts", {
        method: "POST",
        body: JSON.stringify({
          itemSizeId,
          countDate: date,
          fullBottles: values.full,
          partialPercent: values.partial,
        }),
      })
    );

    await Promise.all(writes);
    showToast(`${selectedArea} counts saved.`);
  }

  function setArea(area) {
    selectedArea = area;
    setAreaToggleState(selectedArea, [
      { area: "FOH", button: fohButton },
      { area: "BOH", button: bohButton },
    ]);
    loadCountSheet().catch((e) => showToast(e.message, true));
  }

  countDateInput.value = todayYMD();
  loadCountSheetButton.addEventListener("click", () => loadCountSheet().catch((e) => showToast(e.message, true)));
  saveCountsButton.addEventListener("click", () => saveCounts().catch((e) => showToast(e.message, true)));
  fohButton.addEventListener("click", () => setArea("FOH"));
  bohButton.addEventListener("click", () => setArea("BOH"));
  setArea("FOH");
}

async function initParLevelsPage() {
  const title = byId("par-levels-title");
  const tableContainer = byId("par-levels-table");
  const saveButton = byId("save-par-levels");
  const fohButton = byId("par-area-foh");
  const bohButton = byId("par-area-boh");
  if (!title || !tableContainer || !saveButton || !fohButton || !bohButton) return;

  let selectedArea = "FOH";

  async function renderArea() {
    const rows = await api(`/api/par-levels?area=${selectedArea}`);
    title.textContent = `${selectedArea} Par and Levels`;

    if (!rows.length) {
      tableContainer.innerHTML = `<p>No ${selectedArea} tracked items in catalog.</p>`;
      return;
    }

    const body = rows
      .map(
        (row) => `
      <tr>
        <td>${row.item_name}</td>
        <td>${row.size_label} (${row.volume_ml}ml)</td>
        <td><input type="number" min="0" step="0.1" data-item-size-id="${row.item_size_id}" data-field="par" value="${row.par_bottles ?? ""}" placeholder="e.g. 6" /></td>
        <td><input type="number" min="0" step="0.1" data-item-size-id="${row.item_size_id}" data-field="level" value="${row.level_bottles ?? ""}" placeholder="optional" /></td>
      </tr>
    `
      )
      .join("");

    tableContainer.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Tracked Size</th>
            <th>Par Bottles</th>
            <th>Level Bottles</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    `;
  }

  async function saveParLevels() {
    const inputs = [...tableContainer.querySelectorAll("input[data-item-size-id]")];
    const grouped = new Map();

    for (const input of inputs) {
      const itemSizeId = Number(input.dataset.itemSizeId);
      if (!grouped.has(itemSizeId)) grouped.set(itemSizeId, { parBottles: null, levelBottles: null });
      const field = input.dataset.field;
      if (field === "par") grouped.get(itemSizeId).parBottles = parseNullableNumber(input.value);
      if (field === "level") grouped.get(itemSizeId).levelBottles = parseNullableNumber(input.value);
    }

    const writes = [...grouped.entries()].map(([itemSizeId, values]) =>
      api("/api/par-levels", {
        method: "POST",
        body: JSON.stringify({
          itemSizeId,
          parBottles: values.parBottles,
          levelBottles: values.levelBottles,
        }),
      })
    );

    await Promise.all(writes);
    showToast(`${selectedArea} par and levels saved.`);
  }

  function setArea(area) {
    selectedArea = area;
    setAreaToggleState(selectedArea, [
      { area: "FOH", button: fohButton },
      { area: "BOH", button: bohButton },
    ]);
    renderArea().catch((e) => showToast(e.message, true));
  }

  saveButton.addEventListener("click", () => saveParLevels().catch((e) => showToast(e.message, true)));
  fohButton.addEventListener("click", () => setArea("FOH"));
  bohButton.addEventListener("click", () => setArea("BOH"));
  setArea("FOH");
}

async function initReorderPage() {
  const countDateInput = byId("count-date");
  const buildReorderReportButton = byId("build-reorder-report");
  const reorderReport = byId("reorder-report");
  if (!countDateInput || !buildReorderReportButton || !reorderReport) return;

  async function buildReorderReport() {
    const date = countDateInput.value;
    const rows = await api(`/api/reorder?date=${date}`);

    if (!rows.length) {
      reorderReport.innerHTML = "<p>No tracked catalog items yet.</p>";
      return;
    }

    const body = rows
      .map((r) => {
        const parText = r.hasParLevel ? r.parLevelBottles : "Not Set";
        const levelText = r.levelBottles ?? "Not Set";
        return `
        <tr>
          <td>${r.vendor}</td>
          <td>${r.areaType}</td>
          <td>${r.item}</td>
          <td>${r.size} (${r.volumeMl}ml)</td>
          <td>${parText}</td>
          <td>${levelText}</td>
          <td>${r.onHandBottles}</td>
          <td>${r.bottlesNeeded}</td>
          <td><strong>${r.suggestedCasesToOrder}</strong></td>
        </tr>
      `;
      })
      .join("");

    reorderReport.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Vendor</th>
          <th>Area</th>
          <th>Item</th>
          <th>Tracked Size</th>
          <th>Par</th>
          <th>Level</th>
          <th>On Hand</th>
          <th>Need</th>
          <th>Cases To Order</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
  }

  countDateInput.value = todayYMD();
  buildReorderReportButton.addEventListener("click", () =>
    buildReorderReport().catch((e) => showToast(e.message, true))
  );
  await buildReorderReport();
}

async function initRecipeBuilderPage() {
  const recipeForm = byId("recipe-form");
  if (!recipeForm) return;

  const recipeList = byId("recipe-list");
  const recipeName = byId("recipe-name");
  const recipeCategory = byId("recipe-category");
  const recipeStatus = byId("recipe-status");
  const recipeYieldQty = byId("recipe-yield-qty");
  const recipeYieldUnit = byId("recipe-yield-unit");
  const recipeNotes = byId("recipe-notes");

  const editorCard = byId("recipe-editor-card");
  const editorTitle = byId("editor-title");
  const editorRecipeId = byId("editor-recipe-id");
  const editorRecipeName = byId("editor-recipe-name");
  const editorRecipeCategory = byId("editor-recipe-category");
  const editorRecipeStatus = byId("editor-recipe-status");
  const editorRecipeYieldQty = byId("editor-recipe-yield-qty");
  const editorRecipeYieldUnit = byId("editor-recipe-yield-unit");
  const editorRecipeNotes = byId("editor-recipe-notes");
  const editorTotalCost = byId("editor-total-cost");
  const saveRecipeMeta = byId("save-recipe-meta");
  const saveRecipeLines = byId("save-recipe-lines");
  const addRecipeLine = byId("add-recipe-line");
  const recipeLines = byId("recipe-lines");

  let recipes = [];
  let optionItems = [];
  let optionRecipes = [];

  function itemOptionsHtml(selectedId = null) {
    return optionItems
      .map((item) => {
        const selected = Number(selectedId) === item.id ? "selected" : "";
        const cost =
          item.trackedUnitCost === null ? "No Cost" : `$${Number(item.trackedUnitCost).toFixed(2)}`;
        return `<option value="${item.id}" ${selected}>${item.name} (${item.trackedSizeLabel}, ${cost})</option>`;
      })
      .join("");
  }

  function recipeOptionsHtml(selectedId = null) {
    return optionRecipes
      .map((recipe) => {
        const selected = Number(selectedId) === recipe.id ? "selected" : "";
        return `<option value="${recipe.id}" ${selected}>${recipe.name}</option>`;
      })
      .join("");
  }

  function renderLineBody(row, line = {}) {
    const type = row.querySelector(".rb-line-type").value;
    const body = row.querySelector(".recipe-line-body");

    if (type === "INGREDIENT") {
      body.innerHTML = `
        <label>
          Item Catalog Ingredient
          <select class="rb-ingredient-item">
            <option value="">Select item</option>
            ${itemOptionsHtml(line.ingredientItemId)}
          </select>
        </label>
        <div class="line">
          <label>Quantity <input type="number" min="0" step="0.01" class="rb-qty" value="${line.quantity ?? ""}" /></label>
          <label>Unit <input type="text" class="rb-unit" value="${line.unit ?? "bottle"}" /></label>
          <label>Notes <input type="text" class="rb-notes" value="${line.notes ?? ""}" /></label>
        </div>
      `;
      return;
    }

    if (type === "RECIPE") {
      body.innerHTML = `
        <label>
          Recipe Component
          <select class="rb-ingredient-recipe">
            <option value="">Select recipe</option>
            ${recipeOptionsHtml(line.ingredientRecipeId)}
          </select>
        </label>
        <div class="line">
          <label>Quantity <input type="number" min="0" step="0.01" class="rb-qty" value="${line.quantity ?? "1"}" /></label>
          <label>Unit <input type="text" class="rb-unit" value="${line.unit ?? "x"}" /></label>
          <label>Notes <input type="text" class="rb-notes" value="${line.notes ?? ""}" /></label>
        </div>
      `;
      return;
    }

    if (type === "DIRECTION") {
      body.innerHTML = `
        <label>
          Direction
          <textarea class="rb-direction" rows="2">${line.directionText ?? ""}</textarea>
        </label>
      `;
      return;
    }

    if (type === "COOK_TEMPERATURE") {
      body.innerHTML = `
        <div class="line">
          <label>Temperature <input type="number" min="0" step="0.1" class="rb-cook-temp" value="${line.cookTemperature ?? ""}" /></label>
          <label>Unit <input type="text" class="rb-cook-temp-unit" value="${line.cookTemperatureUnit ?? "F"}" /></label>
          <label>Notes <input type="text" class="rb-notes" value="${line.notes ?? ""}" /></label>
        </div>
      `;
      return;
    }

    if (type === "TIME") {
      body.innerHTML = `
        <div class="line">
          <label>Time Value <input type="number" min="0" step="0.1" class="rb-time-value" value="${line.timeValue ?? ""}" /></label>
          <label>Time Unit <input type="text" class="rb-time-unit" value="${line.timeUnit ?? "minutes"}" /></label>
          <label>Notes <input type="text" class="rb-notes" value="${line.notes ?? ""}" /></label>
        </div>
      `;
      return;
    }

    body.innerHTML = `
      <label>
        Note
        <textarea class="rb-notes" rows="2">${line.notes ?? ""}</textarea>
      </label>
    `;
  }

  function addRecipeLineRow(line = {}) {
    const row = document.createElement("div");
    row.className = "recipe-line";
    row.innerHTML = `
      <div class="recipe-line-head">
        <label>
          Line Type
          <select class="rb-line-type">
            <option value="INGREDIENT">Ingredient</option>
            <option value="RECIPE">Recipe</option>
            <option value="DIRECTION">Direction</option>
            <option value="COOK_TEMPERATURE">Cook Temperature</option>
            <option value="TIME">Time</option>
            <option value="NOTE">Note</option>
          </select>
        </label>
        <button type="button" class="secondary mini-btn rb-remove-line">Remove</button>
      </div>
      <div class="recipe-line-body"></div>
    `;

    const typeSelect = row.querySelector(".rb-line-type");
    typeSelect.value = line.lineType || "INGREDIENT";
    typeSelect.addEventListener("change", () => renderLineBody(row));
    row.querySelector(".rb-remove-line").addEventListener("click", () => row.remove());

    renderLineBody(row, line);
    recipeLines.appendChild(row);
  }

  function collectLinesPayload() {
    const rows = [...recipeLines.querySelectorAll(".recipe-line")];
    return rows.map((row) => {
      const lineType = row.querySelector(".rb-line-type").value;
      const payload = { lineType };

      if (lineType === "INGREDIENT") {
        payload.ingredientItemId = parseNullableNumber(row.querySelector(".rb-ingredient-item")?.value);
        payload.quantity = parseNullableNumber(row.querySelector(".rb-qty")?.value);
        payload.unit = row.querySelector(".rb-unit")?.value?.trim() || null;
        payload.notes = row.querySelector(".rb-notes")?.value?.trim() || null;
      } else if (lineType === "RECIPE") {
        payload.ingredientRecipeId = parseNullableNumber(row.querySelector(".rb-ingredient-recipe")?.value);
        payload.quantity = parseNullableNumber(row.querySelector(".rb-qty")?.value);
        payload.unit = row.querySelector(".rb-unit")?.value?.trim() || null;
        payload.notes = row.querySelector(".rb-notes")?.value?.trim() || null;
      } else if (lineType === "DIRECTION") {
        payload.directionText = row.querySelector(".rb-direction")?.value?.trim() || null;
      } else if (lineType === "COOK_TEMPERATURE") {
        payload.cookTemperature = parseNullableNumber(row.querySelector(".rb-cook-temp")?.value);
        payload.cookTemperatureUnit = row.querySelector(".rb-cook-temp-unit")?.value?.trim() || null;
        payload.notes = row.querySelector(".rb-notes")?.value?.trim() || null;
      } else if (lineType === "TIME") {
        payload.timeValue = parseNullableNumber(row.querySelector(".rb-time-value")?.value);
        payload.timeUnit = row.querySelector(".rb-time-unit")?.value?.trim() || null;
        payload.notes = row.querySelector(".rb-notes")?.value?.trim() || null;
      } else if (lineType === "NOTE") {
        payload.notes = row.querySelector(".rb-notes")?.value?.trim() || null;
      }

      return payload;
    });
  }

  async function loadOptions(activeRecipeId) {
    const opts = await api(`/api/recipe-builder/options?recipeId=${activeRecipeId}`);
    optionItems = opts.items || [];
    optionRecipes = opts.recipes || [];
  }

  async function openRecipe(recipeId) {
    const recipe = await api(`/api/recipe-builder/recipes/${recipeId}`);
    await loadOptions(recipeId);

    editorRecipeId.value = String(recipe.id);
    editorRecipeName.value = recipe.name;
    editorRecipeCategory.value = recipe.category || "General";
    editorRecipeStatus.value = recipe.status || "Draft";
    editorRecipeYieldQty.value = recipe.yieldQty ?? "";
    editorRecipeYieldUnit.value = recipe.yieldUnit ?? "";
    editorRecipeNotes.value = recipe.notes ?? "";
    editorTotalCost.textContent = `$${Number(recipe.totalCost || 0).toFixed(2)}`;
    editorTitle.textContent = `Recipe Editor: ${recipe.name}`;

    recipeLines.innerHTML = "";
    for (const line of recipe.lines || []) addRecipeLineRow(line);
    editorCard.hidden = false;
    editorCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function loadRecipes() {
    recipes = await api("/api/recipe-builder/recipes");
    if (!recipes.length) {
      recipeList.innerHTML = "<p>No recipes yet.</p>";
      return;
    }

    recipeList.innerHTML = `
      <table>
        <thead><tr><th>Name</th><th>Category</th><th>Status</th><th>Total Cost</th><th>Action</th></tr></thead>
        <tbody>
          ${recipes
            .map(
              (recipe) => `<tr>
                <td>${recipe.name}</td>
                <td>${recipe.category || ""}</td>
                <td>${recipe.status || ""}</td>
                <td>$${Number(recipe.totalCost || 0).toFixed(2)}</td>
                <td><button type="button" class="secondary mini-btn rb-open-recipe" data-recipe-id="${recipe.id}">Open</button></td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;

    recipeList.querySelectorAll(".rb-open-recipe").forEach((button) => {
      button.addEventListener("click", () =>
        openRecipe(Number(button.dataset.recipeId)).catch((error) => showToast(error.message, true))
      );
    });
  }

  recipeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const created = await api("/api/recipe-builder/recipes", {
        method: "POST",
        body: JSON.stringify({
          name: recipeName.value.trim(),
          category: recipeCategory.value.trim() || "General",
          status: recipeStatus.value,
          yieldQty: parseNullableNumber(recipeYieldQty.value),
          yieldUnit: recipeYieldUnit.value.trim() || null,
          notes: recipeNotes.value.trim() || "",
        }),
      });
      recipeForm.reset();
      recipeCategory.value = "General";
      recipeStatus.value = "Draft";
      await loadRecipes();
      await openRecipe(created.id);
      showToast("Recipe created.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  saveRecipeMeta.addEventListener("click", async () => {
    try {
      const id = Number(editorRecipeId.value);
      await api(`/api/recipe-builder/recipes/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: editorRecipeName.value.trim(),
          category: editorRecipeCategory.value.trim() || "General",
          status: editorRecipeStatus.value,
          yieldQty: parseNullableNumber(editorRecipeYieldQty.value),
          yieldUnit: editorRecipeYieldUnit.value.trim() || null,
          notes: editorRecipeNotes.value.trim() || "",
        }),
      });
      await loadRecipes();
      showToast("Recipe header saved.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  saveRecipeLines.addEventListener("click", async () => {
    try {
      const id = Number(editorRecipeId.value);
      await api(`/api/recipe-builder/recipes/${id}/lines`, {
        method: "PUT",
        body: JSON.stringify({ lines: collectLinesPayload() }),
      });
      await loadRecipes();
      await openRecipe(id);
      showToast("Recipe lines saved.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  addRecipeLine.addEventListener("click", () => addRecipeLineRow());

  await loadRecipes();
}

async function init() {
  await initVendorPage();
  await initAddItemPage();
  await initItemCatalogPage();
  await initAreasPage();
  await initCountsPage();
  await initParLevelsPage();
  await initReorderPage();
  await initRecipeBuilderPage();
}

init().catch((error) => showToast(error.message, true));
