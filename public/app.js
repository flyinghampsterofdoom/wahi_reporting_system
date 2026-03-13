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
  defaults = { id: null, sizeLabel: "", volumeMl: 750, isTracked: false },
  trackGroup = `${sizeRowsContainer.id}-track`
) {
  const row = document.createElement("div");
  row.className = "size-row";
  row.innerHTML = `
    <input type="hidden" class="size-id" value="${defaults.id ?? ""}" />
    <label>Label <input type="text" class="size-label" value="${defaults.sizeLabel}" placeholder="750ml" required /></label>
    <label>Volume ml <input type="number" class="size-volume" min="1" value="${defaults.volumeMl}" required /></label>
    <label class="track-label">Track Item Size <input type="radio" class="size-tracked" name="${trackGroup}" ${defaults.isTracked ? "checked" : ""} /></label>
    <button type="button" class="secondary remove-size">Remove</button>
  `;
  row.querySelector(".remove-size").addEventListener("click", () => row.remove());
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
      isTracked: row.querySelector(".size-tracked")?.checked || false,
    };
    if (idValue) payload.id = Number(idValue);
    return payload;
  });
}

async function initAddItemPage() {
  const vendorForm = byId("vendor-form");
  if (!vendorForm) return;

  const vendorNameInput = byId("vendor-name");
  const itemForm = byId("item-form");
  const itemNameInput = byId("item-name");
  const itemVendorSelect = byId("item-vendor");
  const itemCaseSizeInput = byId("item-case-size");
  const itemAreaTypeSelect = byId("item-area-type");
  const sizeRowsContainer = byId("size-rows");
  const addSizeRowButton = byId("add-size-row");

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

  vendorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/vendors", {
        method: "POST",
        body: JSON.stringify({ name: vendorNameInput.value.trim() }),
      });
      vendorNameInput.value = "";
      await loadVendors();
      showToast("Vendor added and saved.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

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
          sizes: collectSizesFrom(sizeRowsContainer),
        }),
      });

      itemNameInput.value = "";
      itemCaseSizeInput.value = 12;
      itemAreaTypeSelect.value = "FOH";
      sizeRowsContainer.innerHTML = "";
      addSizeRow(sizeRowsContainer, { sizeLabel: "1L", volumeMl: 1000, isTracked: true });
      addSizeRow(sizeRowsContainer, { sizeLabel: "750ml", volumeMl: 750, isTracked: false });
      showToast("Item created and saved.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  addSizeRowButton.addEventListener("click", () => addSizeRow(sizeRowsContainer));

  addSizeRow(sizeRowsContainer, { sizeLabel: "1L", volumeMl: 1000, isTracked: true });
  addSizeRow(sizeRowsContainer, { sizeLabel: "750ml", volumeMl: 750, isTracked: false });
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

  let vendors = [];
  let items = [];

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

            return `<div class="size-line">${s.sizeLabel} (${s.volumeMl}ml) ${trackControl}</div>`;
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
    loadVendorOptions(editItemVendor);
    editItemVendor.value = String(item.vendor.id);

    editSizeRows.innerHTML = "";
    item.sizes.forEach((size) => addSizeRow(editSizeRows, size, "edit-size-track"));

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
  sortBySelect.addEventListener("change", renderCatalog);
  sortDirectionSelect.addEventListener("change", renderCatalog);
  filterVendorSelect.addEventListener("change", renderCatalog);
  filterAreaSelect.addEventListener("change", renderCatalog);
  filterNameInput.addEventListener("input", renderCatalog);
  cancelEditButton.addEventListener("click", closeEdit);
  editAddSizeRowButton.addEventListener("click", () =>
    addSizeRow(editSizeRows, { sizeLabel: "", volumeMl: 750, isTracked: false }, "edit-size-track")
  );

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
          sizes: collectSizesFrom(editSizeRows),
        }),
      });

      await reloadData();
      closeEdit();
      showToast("Item updated.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  await reloadData();
}

async function initCountsPage() {
  const countDateInput = byId("count-date");
  const countSheet = byId("count-sheet");
  const loadCountSheetButton = byId("load-count-sheet");
  const saveCountsButton = byId("save-counts");
  if (!countDateInput || !countSheet || !loadCountSheetButton || !saveCountsButton) return;

  async function loadCountSheet() {
    const date = countDateInput.value;
    const rows = await api(`/api/counts?date=${date}`);

    if (!rows.length) {
      countSheet.innerHTML = "<p>Add catalog items first on the Add Item page.</p>";
      return;
    }

    const tableRows = rows
      .map(
        (r) => `
      <tr>
        <td>${r.item_name}</td>
        <td>${r.size_label} (${r.volume_ml}ml)</td>
        <td><input type="number" min="0" step="0.1" data-id="${r.size_id}" data-field="full" value="${r.full_bottles}" /></td>
        <td><input type="number" min="0" max="100" step="1" data-id="${r.size_id}" data-field="partial" value="${r.partial_percent}" /></td>
      </tr>
    `
      )
      .join("");

    countSheet.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Size</th>
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
    showToast("Counts saved.");
  }

  countDateInput.value = todayYMD();
  loadCountSheetButton.addEventListener("click", () => loadCountSheet().catch((e) => showToast(e.message, true)));
  saveCountsButton.addEventListener("click", () => saveCounts().catch((e) => showToast(e.message, true)));
  await loadCountSheet();
}

async function initParLevelsPage() {
  const fohTable = byId("foh-par-table");
  const bohTable = byId("boh-par-table");
  const saveButton = byId("save-par-levels");
  if (!fohTable || !bohTable || !saveButton) return;

  async function renderArea(area, mountNode) {
    const rows = await api(`/api/par-levels?area=${area}`);
    if (!rows.length) {
      mountNode.innerHTML = `<p>No ${area} items in catalog.</p>`;
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

    mountNode.innerHTML = `
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
    const inputs = [...document.querySelectorAll("input[data-item-size-id]")];
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
    showToast("Par and levels saved.");
  }

  await renderArea("FOH", fohTable);
  await renderArea("BOH", bohTable);
  saveButton.addEventListener("click", () => saveParLevels().catch((e) => showToast(e.message, true)));
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
  buildReorderReportButton.addEventListener("click", () => buildReorderReport().catch((e) => showToast(e.message, true)));
  await buildReorderReport();
}

async function init() {
  await initAddItemPage();
  await initItemCatalogPage();
  await initCountsPage();
  await initParLevelsPage();
  await initReorderPage();
}

init().catch((error) => showToast(error.message, true));
