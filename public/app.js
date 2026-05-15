function byId(id) {
  return document.getElementById(id);
}

const toast = byId("toast");
let currentUser = null;

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

function formatNumberInput(value, places = 4) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return String(Number(n.toFixed(places)));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[char];
  });
}

const ITEM_UNIT_OPTIONS = {
  FLUID: ["fl oz", "oz", "cup", "tbsp", "tsp", "pt", "qt", "gal", "mL", "L"],
  WEIGHT: ["g", "kg", "oz", "lb"],
  EA: ["ea"],
};
const DENSITY_VOLUME_UNIT_OPTIONS = ["fl oz", "oz", "cup", "cups", "tbsp", "tsp", "pt", "qt", "gal", "mL", "L"];

function unitOptionsHtml(measureType, selectedUnit) {
  const options = ITEM_UNIT_OPTIONS[measureType] || ITEM_UNIT_OPTIONS.FLUID;
  return options
    .map((unit) => `<option value="${unit}" ${unit === selectedUnit ? "selected" : ""}>${unit}</option>`)
    .join("");
}

function syncDensityFieldState(selectNode, measureType) {
  if (!selectNode) return;
  const enabled = measureType === "WEIGHT";
  selectNode.disabled = !enabled;
  if (!enabled) selectNode.value = "";
}

function toFloz(amount, unit) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = String(unit || "").toLowerCase();
  if (u === "fl oz" || u === "oz") return n;
  if (u === "ml") return n / 29.5735;
  if (u === "l") return (n * 1000) / 29.5735;
  if (u === "qt") return n * 32;
  if (u === "gal") return n * 128;
  return null;
}

function computePurchaseBreakdown(caseSize, purchaseUnit, purchaseCost, trackedSizeAmount, trackedSizeUnit, measureType) {
  if (purchaseCost === null || purchaseCost === undefined) return null;
  let perBottle = Number(purchaseCost);
  if (purchaseUnit === "CASE") {
    if (!Number(caseSize)) return null;
    perBottle = Number(purchaseCost) / Number(caseSize);
  }
  if (!Number.isFinite(perBottle) || perBottle < 0) return null;
  let divisor = Number(trackedSizeAmount);
  let label = trackedSizeUnit || "unit";
  if (measureType === "FLUID") {
    const floz = toFloz(trackedSizeAmount, trackedSizeUnit);
    if (floz && floz > 0) {
      divisor = floz;
      label = "fl oz";
    }
  }
  const perUnit = Number(divisor) > 0 ? perBottle / Number(divisor) : null;
  return {
    perBottle: Number(perBottle.toFixed(4)),
    perUnit: perUnit === null ? null : Number(perUnit.toFixed(6)),
    perUnitLabel: label,
  };
}

function trackedSizeInfoFromRows(container) {
  const tracked = [...container.querySelectorAll(".size-row")].find(
    (row) => row.querySelector(".size-tracked")?.checked
  );
  if (!tracked) return { amount: null, unit: null };
  const amount = Number(tracked.querySelector(".size-amount")?.value);
  const unit = tracked.querySelector(".size-unit")?.value || null;
  return { amount: Number.isFinite(amount) && amount > 0 ? amount : null, unit };
}

function renderCostPreview(
  previewNode,
  caseSize,
  purchaseUnit,
  purchaseCost,
  trackedSizeAmount,
  trackedSizeUnit,
  measureType
) {
  if (!previewNode) return;
  if (purchaseCost === null || purchaseCost === undefined) {
    previewNode.textContent = "Item Cost not set. Tracked size cost/unit will use manual bottle cost.";
    return;
  }
  const breakdown = computePurchaseBreakdown(
    caseSize,
    purchaseUnit,
    purchaseCost,
    trackedSizeAmount,
    trackedSizeUnit,
    measureType
  );
  if (!breakdown) {
    previewNode.textContent = "Enter valid case size and tracked size amount to calculate cost per bottle and per unit.";
    return;
  }
  const sourceLabel = purchaseUnit === "CASE" ? "case" : "bottle";
  const unitLabel = breakdown.perUnitLabel || trackedSizeUnit || "unit";
  const perUnitText = breakdown.perUnit === null ? "n/a" : `$${breakdown.perUnit.toFixed(6)} / ${unitLabel}`;
  previewNode.textContent = `From $${Number(purchaseCost).toFixed(2)} per ${sourceLabel}: $${breakdown.perBottle.toFixed(4)} per tracked bottle, ${perUnitText}.`;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 && !byId("login-form")) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?next=${next}`;
      throw new Error("Authentication required.");
    }
    throw new Error(body.error || "Request failed");
  }

  if (response.status === 204) return null;
  return response.json();
}

async function loadCurrentUser() {
  if (byId("login-form")) return null;
  const payload = await api("/api/auth/me");
  currentUser = payload.user || null;
  return currentUser;
}

async function initLoginPage() {
  const loginForm = byId("login-form");
  if (!loginForm) return;
  const username = byId("login-username");
  const password = byId("login-password");

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: username.value.trim(),
          password: password.value,
        }),
      });
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next");
      window.location.href = next || "/";
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

async function initSecurityPage() {
  const securityPage = byId("security-page");
  if (!securityPage) return;
  const me = currentUser || (await loadCurrentUser());

  const currentUserLabel = byId("current-user-label");
  if (currentUserLabel && me) {
    currentUserLabel.textContent = `${me.username} (${me.role})`;
  }

  const logoutButton = byId("logout-button");
  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      try {
        await api("/api/auth/logout", { method: "POST" });
        window.location.href = "/login";
      } catch (error) {
        showToast(error.message, true);
      }
    });
  }

  const resetForm = byId("reset-password-form");
  if (resetForm) {
    resetForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api("/api/auth/reset-password", {
          method: "POST",
          body: JSON.stringify({
            currentPassword: byId("current-password").value,
            newPassword: byId("new-password").value,
            newPasswordConfirm: byId("new-password-confirm").value,
          }),
        });
        resetForm.reset();
        showToast("Password updated.");
      } catch (error) {
        showToast(error.message, true);
      }
    });
  }

  const adminOnly = byId("admin-only");
  if (!me || me.role !== "ADMIN") {
    if (adminOnly) adminOnly.style.display = "none";
    return;
  }

  if (adminOnly) adminOnly.style.display = "grid";
  const usersContainer = byId("auth-users");
  const createUserForm = byId("create-user-form");
  const changePasswordForm = byId("admin-change-password-form");
  const targetUserSelect = byId("admin-target-user");

  async function loadUsers() {
    const users = await api("/api/auth/users");
    if (usersContainer) {
      usersContainer.innerHTML = `
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              ${users
                .map(
                  (user) => `
                    <tr>
                      <td>${user.username}</td>
                      <td>${user.role}</td>
                    </tr>
                  `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `;
    }

    if (targetUserSelect) {
      targetUserSelect.innerHTML = users
        .map((user) => `<option value="${user.id}">${user.username} (${user.role})</option>`)
        .join("");
    }
  }

  if (createUserForm) {
    createUserForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api("/api/auth/users", {
          method: "POST",
          body: JSON.stringify({
            username: byId("create-username").value.trim(),
            role: byId("create-role").value,
            password: byId("create-password").value,
            passwordConfirm: byId("create-password-confirm").value,
          }),
        });
        createUserForm.reset();
        await loadUsers();
        showToast("User created.");
      } catch (error) {
        showToast(error.message, true);
      }
    });
  }

  if (changePasswordForm) {
    changePasswordForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api(`/api/auth/users/${targetUserSelect.value}/password`, {
          method: "POST",
          body: JSON.stringify({
            newPassword: byId("admin-new-password").value,
            newPasswordConfirm: byId("admin-new-password-confirm").value,
          }),
        });
        changePasswordForm.reset();
        showToast("User password updated.");
      } catch (error) {
        showToast(error.message, true);
      }
    });
  }

  await loadUsers();
}

function addSizeRow(
  sizeRowsContainer,
  defaults = { id: null, sizeLabel: "", sizeAmount: 750, sizeUnit: "mL", unitCost: null, isTracked: false },
  trackGroup = `${sizeRowsContainer.id}-track`,
  measureType = "FLUID"
) {
  const row = document.createElement("div");
  row.className = "size-row";
  row.innerHTML = `
    <input type="hidden" class="size-id" value="${defaults.id ?? ""}" />
    <label>Label <input type="text" class="size-label" value="${defaults.sizeLabel}" placeholder="750ml" required /></label>
    <label>Amount <input type="number" class="size-amount" min="0.01" step="0.01" value="${defaults.sizeAmount}" required /></label>
    <label>Unit <select class="size-unit">${unitOptionsHtml(measureType, defaults.sizeUnit)}</select></label>
    <label>Cost / Bottle <input type="number" class="size-cost" min="0" step="0.0001" value="${formatNumberInput(defaults.unitCost, 4)}" placeholder="optional" /></label>
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
    const amount = Number(row.querySelector(".size-amount").value);
    const unit = row.querySelector(".size-unit").value;
    const labelText = row.querySelector(".size-label").value.trim();
    const payload = {
      sizeLabel: labelText || `${amount}${unit}`,
      sizeAmount: amount,
      sizeUnit: unit,
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
  const itemMeasureType = byId("item-measure-type");
  const itemPurchaseUnit = byId("item-purchase-unit");
  const itemPurchaseCost = byId("item-purchase-cost");
  const itemDensitySelect = byId("item-density");
  const itemCostPreview = byId("item-cost-preview");
  const sizeRowsContainer = byId("size-rows");
  const addSizeRowButton = byId("add-size-row");

  function refreshAddPreview() {
    const tracked = trackedSizeInfoFromRows(sizeRowsContainer);
    renderCostPreview(
      itemCostPreview,
      Number(itemCaseSizeInput.value),
      itemPurchaseUnit.value,
      parseNullableNumber(itemPurchaseCost.value),
      tracked.amount,
      tracked.unit,
      itemMeasureType.value
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

  async function loadDensities() {
    if (!itemDensitySelect) return;
    const rows = await api("/api/admin/densities");
    const options = rows
      .map((row) => `<option value="${row.id}">${row.ingredientName}</option>`)
      .join("");
    itemDensitySelect.innerHTML = `<option value="">None</option>${options}`;
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
          measureType: itemMeasureType.value,
          densityId: parseNullableNumber(itemDensitySelect?.value),
          purchaseUnit: itemPurchaseUnit.value,
          purchaseCost: parseNullableNumber(itemPurchaseCost.value),
          sizes: collectSizesFrom(sizeRowsContainer),
        }),
      });

      itemNameInput.value = "";
      itemCaseSizeInput.value = 12;
      itemAreaTypeSelect.value = "FOH";
      itemMeasureType.value = "FLUID";
      if (itemDensitySelect) itemDensitySelect.value = "";
      syncDensityFieldState(itemDensitySelect, itemMeasureType.value);
      itemPurchaseUnit.value = "BOTTLE";
      itemPurchaseCost.value = "";
      sizeRowsContainer.innerHTML = "";
      addSizeRow(
        sizeRowsContainer,
        { sizeLabel: "1L", sizeAmount: 1, sizeUnit: "L", isTracked: true },
        undefined,
        itemMeasureType.value
      );
      addSizeRow(
        sizeRowsContainer,
        { sizeLabel: "750mL", sizeAmount: 750, sizeUnit: "mL", isTracked: false },
        undefined,
        itemMeasureType.value
      );
      refreshAddPreview();
      showToast("Item created and saved.");
      window.dispatchEvent(new CustomEvent("catalog-data-changed"));
    } catch (error) {
      showToast(error.message, true);
    }
  });

  addSizeRowButton.addEventListener("click", () => {
    addSizeRow(sizeRowsContainer, undefined, undefined, itemMeasureType.value);
    refreshAddPreview();
  });
  itemMeasureType.addEventListener("change", () => {
    sizeRowsContainer.querySelectorAll(".size-unit").forEach((select) => {
      const selected = select.value;
      const options = ITEM_UNIT_OPTIONS[itemMeasureType.value] || ITEM_UNIT_OPTIONS.FLUID;
      const fallback = options.includes(selected) ? selected : options[0];
      select.innerHTML = unitOptionsHtml(itemMeasureType.value, fallback);
    });
    syncDensityFieldState(itemDensitySelect, itemMeasureType.value);
    refreshAddPreview();
  });
  sizeRowsContainer.addEventListener("input", refreshAddPreview);
  sizeRowsContainer.addEventListener("change", refreshAddPreview);
  itemCaseSizeInput.addEventListener("input", refreshAddPreview);
  itemPurchaseUnit.addEventListener("change", refreshAddPreview);
  itemPurchaseCost.addEventListener("input", refreshAddPreview);
  addSizeRow(
    sizeRowsContainer,
    { sizeLabel: "1L", sizeAmount: 1, sizeUnit: "L", isTracked: true },
    undefined,
    itemMeasureType.value
  );
  addSizeRow(
    sizeRowsContainer,
    { sizeLabel: "750mL", sizeAmount: 750, sizeUnit: "mL", isTracked: false },
    undefined,
    itemMeasureType.value
  );
  syncDensityFieldState(itemDensitySelect, itemMeasureType.value);
  refreshAddPreview();
  await loadVendors();
  await loadDensities();
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
  const saveCatalogEditsButton = byId("save-catalog-edits");
  const catalogSaveStatus = byId("catalog-save-status");
  const openAddItemButton = byId("open-add-item");
  const addItemSection = byId("add-item-section");
  const editSection = byId("edit-item-section");
  const editForm = byId("edit-item-form");
  const cancelEditButton = byId("cancel-edit");
  const closeEditXButton = byId("close-edit-x");
  const editAddSizeRowButton = byId("edit-add-size-row");
  const editSizeRows = byId("edit-size-rows");
  const editItemId = byId("edit-item-id");
  const editItemName = byId("edit-item-name");
  const editItemAreaType = byId("edit-item-area-type");
  const editItemMeasureType = byId("edit-item-measure-type");
  const editItemVendor = byId("edit-item-vendor");
  const editItemDensity = byId("edit-item-density");
  const editItemCaseSize = byId("edit-item-case-size");
  const editItemPurchaseUnit = byId("edit-item-purchase-unit");
  const editItemPurchaseCost = byId("edit-item-purchase-cost");
  const editItemCostPreview = byId("edit-item-cost-preview");

  let vendors = [];
  let items = [];
  let densities = [];
  let pendingInlineEdits = new Map();

  function refreshEditPreview() {
    const tracked = trackedSizeInfoFromRows(editSizeRows);
    renderCostPreview(
      editItemCostPreview,
      Number(editItemCaseSize.value),
      editItemPurchaseUnit.value,
      parseNullableNumber(editItemPurchaseCost.value),
      tracked.amount,
      tracked.unit,
      editItemMeasureType.value
    );
  }

  function vendorForId(vendorId) {
    return vendors.find((vendor) => Number(vendor.id) === Number(vendorId)) || null;
  }

  function basicValuesFor(item) {
    const pending = pendingInlineEdits.get(item.id);
    const vendorId = pending ? pending.vendorId : item.vendor.id;
    return {
      id: item.id,
      name: pending ? pending.name : item.name,
      vendorId: Number(vendorId),
      caseSize: pending ? pending.caseSize : item.caseSize,
      areaType: pending ? pending.areaType : item.areaType,
    };
  }

  function displayItem(item) {
    const values = basicValuesFor(item);
    const vendor = vendorForId(values.vendorId) || item.vendor;
    return {
      ...item,
      name: values.name,
      vendor,
      caseSize: values.caseSize,
      areaType: values.areaType,
    };
  }

  function updateInlineSaveState() {
    const count = pendingInlineEdits.size;
    if (saveCatalogEditsButton) saveCatalogEditsButton.disabled = count === 0;
    if (catalogSaveStatus) {
      catalogSaveStatus.textContent =
        count === 0 ? "No unsaved list changes" : `${count} unsaved list ${count === 1 ? "change" : "changes"}`;
    }
  }

  function normalizeInlineValues(values) {
    return {
      name: String(values.name || "").trim(),
      vendorId: Number(values.vendorId),
      caseSize: Number(values.caseSize),
      areaType: values.areaType,
    };
  }

  function markInlineEdit(itemId, values) {
    const item = items.find((entry) => entry.id === itemId);
    if (!item) return;

    const normalized = normalizeInlineValues(values);
    const baseline = {
      name: item.name,
      vendorId: Number(item.vendor.id),
      caseSize: Number(item.caseSize),
      areaType: item.areaType,
    };
    const changed =
      normalized.name !== baseline.name ||
      normalized.vendorId !== baseline.vendorId ||
      normalized.caseSize !== baseline.caseSize ||
      normalized.areaType !== baseline.areaType;

    if (changed) {
      pendingInlineEdits.set(itemId, normalized);
    } else {
      pendingInlineEdits.delete(itemId);
    }

    const row = catalogList.querySelector(`tr[data-item-id="${itemId}"]`);
    if (row) row.classList.toggle("dirty-row", pendingInlineEdits.has(itemId));
    updateInlineSaveState();
  }

  function inlineValuesFromRow(row) {
    return {
      name: row.querySelector(".catalog-name-input")?.value || "",
      vendorId: row.querySelector(".catalog-vendor-select")?.value || "",
      areaType: row.querySelector(".catalog-area-select")?.value || "",
      caseSize: row.querySelector(".catalog-case-size-input")?.value || "",
    };
  }

  function vendorOptionsHtml(selectedVendorId) {
    return vendors
      .map(
        (vendor) =>
          `<option value="${vendor.id}" ${Number(vendor.id) === Number(selectedVendorId) ? "selected" : ""}>${escapeHtml(
            vendor.name
          )}</option>`
      )
      .join("");
  }

  function areaOptionsHtml(selectedArea) {
    return ["FOH", "BOH"]
      .map((area) => `<option value="${area}" ${area === selectedArea ? "selected" : ""}>${area}</option>`)
      .join("");
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
    const displayItems = items.map(displayItem);
    const filteredItems = applyFilters(displayItems);
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

            return `<div class="size-line">${escapeHtml(s.sizeLabel)} (${escapeHtml(s.sizeAmount)} ${escapeHtml(
              s.sizeUnit
            )}, ${costText}) ${trackControl}</div>`;
          })
          .join("");
        const perText =
          item.trackedCostPerUnit === null
            ? "Tracked price/unit not set"
            : `Tracked Price: $${Number(item.trackedCostPerUnit).toFixed(4)} / ${escapeHtml(
                item.trackedCostPerUnitLabel || "unit"
              )}`;
        const isDirty = pendingInlineEdits.has(item.id);

        return `
          <tr data-item-id="${item.id}" class="${isDirty ? "dirty-row" : ""}">
            <td>
              <select class="catalog-inline-control catalog-vendor-select" data-inline-field="vendorId" aria-label="Vendor for ${escapeHtml(
                item.name
              )}">
                ${vendorOptionsHtml(item.vendor.id)}
              </select>
            </td>
            <td>
              <select class="catalog-inline-control catalog-area-select" data-inline-field="areaType" aria-label="FOH or BOH for ${escapeHtml(
                item.name
              )}">
                ${areaOptionsHtml(item.areaType)}
              </select>
            </td>
            <td>
              <input class="catalog-inline-control catalog-name-input" data-inline-field="name" type="text" value="${escapeHtml(
                item.name
              )}" aria-label="Item name" />
            </td>
            <td>
              <input class="catalog-inline-control catalog-case-size-input" data-inline-field="caseSize" type="number" min="1" step="1" value="${escapeHtml(
                item.caseSize
              )}" aria-label="Case size for ${escapeHtml(item.name)}" />
            </td>
            <td>${sizes}<div class="muted-note">${perText}</div></td>
            <td><button class="secondary edit-item-btn" data-item-id="${item.id}">Edit Item</button></td>
          </tr>
        `;
      })
      .join("");

    catalogList.innerHTML = `
      <div class="table-scroll">
        <table class="catalog-table">
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
      </div>
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
          await reloadData({ preservePending: true });
          showToast("Tracked item size updated.");
        } catch (error) {
          showToast(error.message, true);
        }
      });
    });
  }

  function loadVendorOptions(selectNode) {
    selectNode.innerHTML = vendorOptionsHtml(null);
  }

  function loadDensityOptions(selectNode, selectedDensityId = null) {
    if (!selectNode) return;
    const options = densities
      .map((d) => `<option value="${d.id}">${d.ingredientName}</option>`)
      .join("");
    selectNode.innerHTML = `<option value="">None</option>${options}`;
    if (selectedDensityId) {
      selectNode.value = String(selectedDensityId);
    }
  }

  function loadVendorFilterOptions() {
    const currentValue = filterVendorSelect.value;
    const options = vendors
      .map((v) => `<option value="${v.id}">${escapeHtml(v.name)}</option>`)
      .join("");
    filterVendorSelect.innerHTML = `<option value="">All Vendors</option>${options}`;
    if ([...vendors.map((v) => String(v.id)), ""].includes(currentValue)) {
      filterVendorSelect.value = currentValue;
    }
  }

  function startEdit(itemId) {
    const item = items.find((entry) => entry.id === itemId);
    if (!item) return;
    const basicValues = basicValuesFor(item);

    editItemId.value = String(item.id);
    editItemName.value = basicValues.name;
    editItemAreaType.value = basicValues.areaType;
    editItemMeasureType.value = item.measureType || "FLUID";
    editItemCaseSize.value = String(basicValues.caseSize);
    editItemPurchaseUnit.value = item.purchaseUnit || "BOTTLE";
    editItemPurchaseCost.value = formatNumberInput(item.purchaseCost, 2);
    loadVendorOptions(editItemVendor);
    loadDensityOptions(editItemDensity, item.density?.id ?? null);
    syncDensityFieldState(editItemDensity, editItemMeasureType.value);
    editItemVendor.value = String(basicValues.vendorId);

    editSizeRows.innerHTML = "";
    item.sizes.forEach((size) =>
      addSizeRow(
        editSizeRows,
        {
          ...size,
          sizeAmount: size.sizeAmount ?? size.volumeMl,
          sizeUnit: size.sizeUnit || "mL",
        },
        "edit-size-track",
        editItemMeasureType.value
      )
    );
    refreshEditPreview();

    editSection.hidden = false;
    document.body.classList.add("modal-open");
  }

  function closeEdit() {
    editSection.hidden = true;
    editForm.reset();
    editSizeRows.innerHTML = "";
    document.body.classList.remove("modal-open");
  }

  async function reloadData({ preservePending = false } = {}) {
    const [vendorRows, itemRows, densityRows] = await Promise.all([
      api("/api/vendors"),
      api("/api/items"),
      api("/api/admin/densities"),
    ]);
    vendors = vendorRows;
    items = itemRows;
    densities = densityRows;
    if (preservePending) {
      const itemIds = new Set(items.map((item) => item.id));
      [...pendingInlineEdits.keys()].forEach((id) => {
        if (!itemIds.has(id)) pendingInlineEdits.delete(id);
      });
    } else {
      pendingInlineEdits.clear();
    }
    loadDensityOptions(byId("item-density"));
    syncDensityFieldState(byId("item-density"), byId("item-measure-type")?.value || "FLUID");
    loadVendorFilterOptions();
    renderCatalog();
    updateInlineSaveState();
  }

  async function saveInlineEdits() {
    const updates = [...pendingInlineEdits.entries()].map(([id, values]) => ({
      id,
      ...normalizeInlineValues(values),
    }));
    if (!updates.length) return;

    const invalid = updates.find(
      (update) =>
        !update.name ||
        !Number.isInteger(update.vendorId) ||
        update.vendorId <= 0 ||
        !Number.isInteger(update.caseSize) ||
        update.caseSize <= 0 ||
        !["FOH", "BOH"].includes(update.areaType)
    );
    if (invalid) {
      showToast("Check item name, vendor, FOH/BOH, and case size before saving.", true);
      return;
    }

    try {
      if (saveCatalogEditsButton) saveCatalogEditsButton.disabled = true;
      if (catalogSaveStatus) catalogSaveStatus.textContent = `Saving ${updates.length} list ${updates.length === 1 ? "change" : "changes"}...`;
      const result = await api("/api/items/batch-basic", {
        method: "PATCH",
        body: JSON.stringify({ items: updates }),
      });
      pendingInlineEdits.clear();
      await reloadData();
      showToast(`Saved ${result.updated} list ${result.updated === 1 ? "change" : "changes"}.`);
    } catch (error) {
      showToast(error.message, true);
      updateInlineSaveState();
    }
  }

  refreshButton.addEventListener("click", () => {
    if (pendingInlineEdits.size && !window.confirm("Discard unsaved list changes and refresh?")) return;
    reloadData().catch((e) => showToast(e.message, true));
  });
  if (saveCatalogEditsButton) {
    saveCatalogEditsButton.addEventListener("click", () => saveInlineEdits());
  }
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
  catalogList.addEventListener("input", (event) => {
    if (!event.target.matches("[data-inline-field]")) return;
    const row = event.target.closest("tr[data-item-id]");
    if (!row) return;
    markInlineEdit(Number(row.dataset.itemId), inlineValuesFromRow(row));
  });
  catalogList.addEventListener("change", (event) => {
    if (!event.target.matches("[data-inline-field]")) return;
    const row = event.target.closest("tr[data-item-id]");
    if (!row) return;
    markInlineEdit(Number(row.dataset.itemId), inlineValuesFromRow(row));
  });
  cancelEditButton.addEventListener("click", closeEdit);
  if (closeEditXButton) {
    closeEditXButton.addEventListener("click", closeEdit);
  }
  editSection.addEventListener("click", (event) => {
    if (event.target === editSection) closeEdit();
  });
  editAddSizeRowButton.addEventListener("click", () =>
    addSizeRow(
      editSizeRows,
      { sizeLabel: "", sizeAmount: 1, sizeUnit: "mL", unitCost: null, isTracked: false },
      "edit-size-track",
      editItemMeasureType.value
    )
  );
  editItemMeasureType.addEventListener("change", () => {
    editSizeRows.querySelectorAll(".size-unit").forEach((select) => {
      const selected = select.value;
      const options = ITEM_UNIT_OPTIONS[editItemMeasureType.value] || ITEM_UNIT_OPTIONS.FLUID;
      const fallback = options.includes(selected) ? selected : options[0];
      select.innerHTML = unitOptionsHtml(editItemMeasureType.value, fallback);
    });
    syncDensityFieldState(editItemDensity, editItemMeasureType.value);
    refreshEditPreview();
  });
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
          measureType: editItemMeasureType.value,
          vendorId: Number(editItemVendor.value),
          densityId: parseNullableNumber(editItemDensity?.value),
          caseSize: Number(editItemCaseSize.value),
          purchaseUnit: editItemPurchaseUnit.value,
          purchaseCost: parseNullableNumber(editItemPurchaseCost.value),
          sizes: collectSizesFrom(editSizeRows),
        }),
      });

      pendingInlineEdits.delete(id);
      await reloadData({ preservePending: true });
      closeEdit();
      showToast("Item updated.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  window.addEventListener("catalog-data-changed", () => {
    reloadData({ preservePending: true }).catch((e) => showToast(e.message, true));
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
        <td>${r.size_label} (${r.size_amount ?? r.volume_ml} ${r.size_unit || "mL"})</td>
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
        <td>${row.size_label} (${row.size_amount ?? row.volume_ml} ${row.size_unit || "mL"})</td>
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
          <td>${r.size} (${r.sizeAmount ?? r.volumeMl} ${r.sizeUnit || "mL"})</td>
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

async function initRecipeCreatePage() {
  const recipeForm = byId("recipe-form");
  const recipeName = byId("recipe-name");
  if (!recipeForm || !recipeName) return;

  const recipeCategory = byId("recipe-category");
  const recipeStatus = byId("recipe-status");
  const recipeYieldQty = byId("recipe-yield-qty");
  const recipeYieldUnit = byId("recipe-yield-unit");
  const recipeNotes = byId("recipe-notes");

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
      showToast("Recipe created.");
      window.location.href = `/recipe-builder?recipeId=${encodeURIComponent(created.id)}`;
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

async function initRecipeBuilderPage() {
  const recipeList = byId("recipe-list");
  if (!recipeList) return;
  const pageParams = new URLSearchParams(window.location.search);
  const isViewMode = String(pageParams.get("mode") || "").toLowerCase() === "view";

  const recipeListCard = recipeList.closest("article");
  const recipeBuilderGrid = byId("recipe-builder-grid");
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
  const editorUnitCost = byId("editor-unit-cost");
  const saveRecipeMeta = byId("save-recipe-meta");
  const saveRecipeLines = byId("save-recipe-lines");
  const addRecipeLine = byId("add-recipe-line");
  const switchToEdit = byId("switch-to-edit");
  const recipeLines = byId("recipe-lines");

  let recipes = [];
  let recipeListLoaded = false;
  let optionItems = [];
  let optionRecipes = [];
  let optionYields = [];

  function setEditorOnlyMode(enabled) {
    if (recipeListCard) recipeListCard.hidden = enabled;
    if (recipeBuilderGrid) recipeBuilderGrid.classList.toggle("editor-only", enabled);
  }

  function applyEditorReadOnlyState() {
    if (!isViewMode || !editorCard || editorCard.hidden) return;

    editorTitle.textContent = editorTitle.textContent.replace(/^Recipe Editor:/, "Recipe View:");

    [saveRecipeMeta, saveRecipeLines, addRecipeLine].forEach((button) => {
      if (!button) return;
      button.disabled = true;
      button.style.display = "none";
    });
    if (switchToEdit) {
      switchToEdit.style.display = "inline-block";
      switchToEdit.disabled = false;
    }

    const editableFields = [
      editorRecipeName,
      editorRecipeCategory,
      editorRecipeStatus,
      editorRecipeYieldQty,
      editorRecipeYieldUnit,
      editorRecipeNotes,
    ];
    editableFields.forEach((field) => {
      if (!field) return;
      field.disabled = true;
      field.readOnly = true;
    });

    recipeLines.querySelectorAll(".rb-remove-line").forEach((button) => {
      button.disabled = true;
      button.style.display = "none";
    });

    recipeLines.querySelectorAll("input, select, textarea, button").forEach((node) => {
      if (node.classList.contains("rb-line-cost")) return;
      if (node.classList.contains("rb-remove-line")) return;
      node.disabled = true;
      if (Object.prototype.hasOwnProperty.call(node, "readOnly")) {
        node.readOnly = true;
      }
    });
  }

  function itemOptionsHtml(selectedId = null) {
    return optionItems
      .map((item) => {
        const selected = Number(selectedId) === item.id ? "selected" : "";
        const pricebookUnitCost = pricebookCostPerSizeUnit(item);
        let perText = pricebookUnitCost === null ? "No Cost" : `$${pricebookUnitCost.toFixed(4)} / ${displayTrackedSizeUnit(item)}`;
        if (pricebookUnitCost === null && item.trackedUnitCost !== null && item.trackedUnitCost !== undefined) {
          if (item.measureType === "FLUID") {
            const floz = toFloz(item.trackedSizeAmount, item.trackedSizeUnit);
            if (floz && floz > 0) {
              perText = `$${Number(item.trackedUnitCost / floz).toFixed(4)} / fl oz`;
            } else {
              perText = `$${Number(item.trackedUnitCost).toFixed(2)} / bottle`;
            }
          } else {
            perText = `$${Number(item.trackedUnitCost).toFixed(4)} / ${item.trackedSizeUnit || "unit"}`;
          }
        }
        return `<option value="${item.id}" ${selected}>${escapeHtml(item.name)} (${escapeHtml(
          item.trackedSizeLabel
        )}, ${escapeHtml(perText)})</option>`;
      })
      .join("");
  }

  function approximatelyEqualAmount(left, right, tolerance = 0.0001) {
    const l = Number(left);
    const r = Number(right);
    if (!Number.isFinite(l) || !Number.isFinite(r)) return false;
    return Math.abs(l - r) <= Math.max(tolerance, Math.abs(r) * 1e-8);
  }

  function isPricebookItem(item) {
    return String(item?.sourceSystem || "").toLowerCase() === "pricebook";
  }

  function displayTrackedSizeUnit(item) {
    const unit = item?.trackedSizeUnit || "unit";
    if (String(item?.measureType || "").toUpperCase() === "FLUID" && String(unit).toLowerCase() === "oz") {
      return "fl oz";
    }
    return unit;
  }

  function pricebookUnitCostIsPackageCost(item) {
    const trackedUnitCost = Number(item?.trackedUnitCost);
    const purchaseCost = Number(item?.purchaseCost);
    const trackedSizeAmount = Number(item?.trackedSizeAmount);
    return (
      isPricebookItem(item) &&
      Number.isFinite(trackedUnitCost) &&
      Number.isFinite(purchaseCost) &&
      Number.isFinite(trackedSizeAmount) &&
      trackedSizeAmount > 0 &&
      approximatelyEqualAmount(trackedUnitCost, purchaseCost)
    );
  }

  function pricebookCostPerSizeUnit(item) {
    if (!isPricebookItem(item)) return null;
    const trackedUnitCost = Number(item?.trackedUnitCost);
    if (!Number.isFinite(trackedUnitCost) || trackedUnitCost < 0) return null;
    if (pricebookUnitCostIsPackageCost(item)) {
      return trackedUnitCost / Number(item.trackedSizeAmount);
    }
    return trackedUnitCost;
  }

  function pricebookQuantityInSizeUnit(item, qty, unit) {
    const trackedSizeUnit = item?.trackedSizeUnit || null;
    if (!trackedSizeUnit) return null;

    const fromUnit = unit || trackedSizeUnit;
    const direct = convertEditorQuantity(qty, fromUnit, trackedSizeUnit);
    if (direct !== null && Number.isFinite(direct)) return direct;

    const gramsPerCup = editorGramsPerCup(item);
    if (!gramsPerCup) return null;

    const sizeCategory = editorUnitCategory(trackedSizeUnit);
    const fromCategory = editorUnitCategory(fromUnit);

    if (sizeCategory === "WEIGHT" && fromCategory === "VOLUME") {
      const qtyCups = convertEditorQuantity(qty, fromUnit, "cup");
      if (qtyCups === null) return null;
      return convertEditorQuantity(qtyCups * gramsPerCup, "g", trackedSizeUnit);
    }

    if (sizeCategory === "VOLUME" && fromCategory === "WEIGHT") {
      const qtyGrams = convertEditorQuantity(qty, fromUnit, "g");
      if (qtyGrams === null) return null;
      return convertEditorQuantity(qtyGrams / gramsPerCup, "cup", trackedSizeUnit);
    }

    return null;
  }

  function ingredientUnitOptions(selectedItemId, selectedUnit = "") {
    const item = optionItems.find((entry) => Number(entry.id) === Number(selectedItemId));
    const measureType = item?.measureType || "FLUID";
    const hasDensityBridge =
      measureType === "WEIGHT" &&
      ((item?.densityGramsPerCup !== null && item?.densityGramsPerCup !== undefined) ||
        (item?.densityCupsPerLb !== null && item?.densityCupsPerLb !== undefined));
    const baseOptions = ITEM_UNIT_OPTIONS[measureType] || ITEM_UNIT_OPTIONS.FLUID;
    const options = hasDensityBridge ? [...baseOptions, ...DENSITY_VOLUME_UNIT_OPTIONS] : baseOptions;
    const defaultUnit = item?.measureType === "FLUID" ? "fl oz" : options[0];
    return options
      .map(
        (unit) =>
          `<option value="${escapeHtml(unit)}" ${
            unit === (selectedUnit || defaultUnit) ? "selected" : ""
          }>${escapeHtml(unit)}</option>`
      )
      .join("");
  }

  function recipeOptionsHtml(selectedId = null) {
    return optionRecipes
      .map((recipe) => {
        const selected = Number(selectedId) === recipe.id ? "selected" : "";
        return `<option value="${recipe.id}" ${selected}>${escapeHtml(recipe.name)}</option>`;
      })
      .join("");
  }

  function lineCostDisplay(line) {
    if (line.lineCost === null || line.lineCost === undefined) return "n/a";
    const n = Number(line.lineCost);
    if (!Number.isFinite(n)) return "n/a";
    return `$${n.toFixed(4)}`;
  }

  function costPerYieldUnit(recipe) {
    const explicit = Number(recipe?.costPerYieldUnit);
    if (Number.isFinite(explicit) && explicit >= 0) return explicit;
    const total = Number(recipe?.totalCost);
    const yieldQty = Number(recipe?.yieldQty);
    if (!Number.isFinite(total) || !Number.isFinite(yieldQty) || yieldQty <= 0) return null;
    return total / yieldQty;
  }

  function costPerYieldDisplay(recipe) {
    const unitCost = costPerYieldUnit(recipe);
    if (unitCost === null) return "n/a";
    const unit = String(recipe?.yieldUnit || "yield unit").trim() || "yield unit";
    return `$${unitCost.toFixed(4)} / ${unit}`;
  }

  function normalizeEditorUnit(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\./g, "")
      .replace(/\s+/g, " ");
  }

  function normalizeEditorName(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function editorUnitCategory(value) {
    const unit = normalizeEditorUnit(value);
    const volumeUnits = new Set([
      "ml",
      "l",
      "fl oz",
      "floz",
      "oz",
      "qt",
      "quart",
      "quarts",
      "gal",
      "gallon",
      "gallons",
      "cup",
      "cups",
      "tbsp",
      "tablespoon",
      "tablespoons",
      "tsp",
      "teaspoon",
      "teaspoons",
      "pt",
      "pint",
      "pints",
    ]);
    const weightUnits = new Set([
      "g",
      "gram",
      "grams",
      "kg",
      "oz wt",
      "oz",
      "ounce",
      "ounces",
      "lb",
      "lbs",
      "pound",
      "pounds",
    ]);
    const eachUnits = new Set(["ea", "each", "x", "count"]);
    if (volumeUnits.has(unit)) return "VOLUME";
    if (weightUnits.has(unit)) return "WEIGHT";
    if (eachUnits.has(unit)) return "EACH";
    return "OTHER";
  }

  function editorUnitFactor(unit, category) {
    const normalized = normalizeEditorUnit(unit);
    if (!normalized) return null;

    if (category === "VOLUME") {
      const map = {
        "fl oz": 1,
        floz: 1,
        oz: 1,
        ml: 1 / 29.5735,
        l: 33.8140227,
        qt: 32,
        quart: 32,
        quarts: 32,
        gal: 128,
        gallon: 128,
        gallons: 128,
        cup: 8,
        cups: 8,
        tbsp: 0.5,
        tablespoon: 0.5,
        tablespoons: 0.5,
        tsp: 1 / 6,
        teaspoon: 1 / 6,
        teaspoons: 1 / 6,
        pt: 16,
        pint: 16,
        pints: 16,
      };
      return map[normalized] ?? null;
    }

    if (category === "WEIGHT") {
      const map = {
        g: 1,
        gram: 1,
        grams: 1,
        kg: 1000,
        oz: 28.349523125,
        ounce: 28.349523125,
        ounces: 28.349523125,
        lb: 453.59237,
        lbs: 453.59237,
        pound: 453.59237,
        pounds: 453.59237,
      };
      return map[normalized] ?? null;
    }

    if (category === "EACH") {
      const map = { ea: 1, each: 1, x: 1, count: 1 };
      return map[normalized] ?? null;
    }

    return null;
  }

  function convertEditorQuantity(quantity, fromUnit, toUnit) {
    const qty = Number(quantity);
    if (!Number.isFinite(qty)) return null;
    const from = normalizeEditorUnit(fromUnit);
    const to = normalizeEditorUnit(toUnit);
    if (!from && !to) return qty;
    if (!from || !to || from === to) return qty;

    const toCategory = editorUnitCategory(to);
    const fromCategory = editorUnitCategory(from);
    const category = toCategory !== "OTHER" ? toCategory : fromCategory;
    if (category === "OTHER" || (toCategory !== "OTHER" && fromCategory !== "OTHER" && toCategory !== fromCategory)) {
      return null;
    }

    const fromFactor = editorUnitFactor(from, category);
    const toFactor = editorUnitFactor(to, category);
    if (!fromFactor || !toFactor) return null;
    return (qty * fromFactor) / toFactor;
  }

  function editorGramsPerCup(item) {
    const gpc = Number(item?.densityGramsPerCup);
    if (Number.isFinite(gpc) && gpc > 0) return gpc;
    const cplb = Number(item?.densityCupsPerLb);
    if (Number.isFinite(cplb) && cplb > 0) return 453.59237 / cplb;
    return null;
  }

  function parseSourceNameFromNotesText(text) {
    const match = String(text || "").match(/Source:\s*([^|]+)/i);
    if (!match) return null;
    const value = String(match[1] || "").trim();
    return value || null;
  }

  function parseSourceLineCostFromNotesText(text) {
    const match = String(text || "").match(/LineCost:\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }

  function optionYieldUnitPrice(y) {
    const direct = Number(y?.pricePerYieldUnit);
    if (Number.isFinite(direct) && direct >= 0) return direct;
    const sourcePer = Number(y?.sourcePerPrice);
    const yieldValue = Number(y?.yieldValue);
    if (Number.isFinite(sourcePer) && Number.isFinite(yieldValue) && yieldValue > 0) {
      return sourcePer / yieldValue;
    }
    return null;
  }

  function ingredientYieldLiveLineCost(item, qty, unit, sourceNoteText = "") {
    if (!item || !optionYields.length) return null;
    const sourceName = normalizeEditorName(parseSourceNameFromNotesText(sourceNoteText));
    const ingredientName = normalizeEditorName(item.name);

    const candidates = [];
    for (const y of optionYields) {
      const unitPrice = optionYieldUnitPrice(y);
      if (unitPrice === null) continue;
      const qtyInYieldUnit = convertEditorQuantity(qty, unit || y.yieldUnit, y.yieldUnit);
      if (qtyInYieldUnit === null || !Number.isFinite(qtyInYieldUnit)) continue;

      const productName = normalizeEditorName(y.productName);
      const sourceIngredient = normalizeEditorName(y.sourceIngredient);
      let priority = 99;
      if (sourceName && sourceName === productName) priority = 1;
      else if (sourceName && sourceName === sourceIngredient) priority = 2;
      else if (ingredientName && ingredientName === sourceIngredient) priority = 3;
      else if (ingredientName && ingredientName === productName) priority = 4;
      if (priority === 99) continue;

      candidates.push({ priority, cost: qtyInYieldUnit * unitPrice });
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => a.priority - b.priority);
    return candidates[0].cost;
  }

  function ingredientLiveLineCost(item, qty, unit, sourceNoteText = "") {
    if (!item) return null;
    const yieldBased = ingredientYieldLiveLineCost(item, qty, unit, sourceNoteText);
    if (yieldBased !== null) return yieldBased;
    if (item.trackedUnitCost === null || item.trackedUnitCost === undefined) return null;
    const measureType = String(item.measureType || "").toUpperCase();
    const trackedUnitCost = Number(item.trackedUnitCost);
    const trackedSizeAmount = Number(item.trackedSizeAmount);
    const trackedSizeUnit = item.trackedSizeUnit || null;
    if (!Number.isFinite(trackedUnitCost) || trackedUnitCost < 0) return null;

    const pricebookCost = pricebookLiveLineCost(item, qty, unit, sourceNoteText);
    if (pricebookCost !== null) return pricebookCost;

    if (measureType === "FLUID") {
      const baseQtyPerTracked = convertEditorQuantity(trackedSizeAmount, trackedSizeUnit || "fl oz", "fl oz");
      const qtyFloz = convertEditorQuantity(qty, unit || "fl oz", "fl oz");
      if (!baseQtyPerTracked || baseQtyPerTracked <= 0 || qtyFloz === null) return null;
      return qtyFloz * (trackedUnitCost / baseQtyPerTracked);
    }

    if (measureType === "WEIGHT") {
      const baseQtyPerTracked = convertEditorQuantity(trackedSizeAmount, trackedSizeUnit || "g", "g");
      if (!baseQtyPerTracked || baseQtyPerTracked <= 0) return null;
      let qtyGrams = convertEditorQuantity(qty, unit || "g", "g");
      if (qtyGrams === null) {
        const gramsPerCup = editorGramsPerCup(item);
        const qtyCups = convertEditorQuantity(qty, unit || "cup", "cup");
        if (gramsPerCup && gramsPerCup > 0 && qtyCups !== null) qtyGrams = qtyCups * gramsPerCup;
      }
      if (qtyGrams === null) return null;
      return qtyGrams * (trackedUnitCost / baseQtyPerTracked);
    }

    if (measureType === "EA") {
      const baseQtyPerTracked = convertEditorQuantity(trackedSizeAmount || 1, trackedSizeUnit || "ea", "ea");
      const qtyEa = convertEditorQuantity(qty, unit || "ea", "ea");
      if (!baseQtyPerTracked || baseQtyPerTracked <= 0 || qtyEa === null) return null;
      return qtyEa * (trackedUnitCost / baseQtyPerTracked);
    }

    return null;
  }

  function pricebookLiveLineCost(item, qty, unit, sourceNoteText = "") {
    if (!isPricebookItem(item)) return null;
    const amount = Number(qty);
    const trackedUnitCost = Number(item.trackedUnitCost);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(trackedUnitCost) || trackedUnitCost < 0) {
      return null;
    }

    const qtyInSizeUnit = pricebookQuantityInSizeUnit(item, amount, unit);
    if (qtyInSizeUnit === null || !Number.isFinite(qtyInSizeUnit)) return null;

    const directCost = qtyInSizeUnit * trackedUnitCost;
    const trackedSizeAmount = Number(item.trackedSizeAmount);
    const packageCost =
      Number.isFinite(trackedSizeAmount) && trackedSizeAmount > 0
        ? qtyInSizeUnit * (trackedUnitCost / trackedSizeAmount)
        : null;
    const sourceLineCost = parseSourceLineCostFromNotesText(sourceNoteText);

    if (sourceLineCost !== null && packageCost !== null) {
      return Math.abs(packageCost - sourceLineCost) < Math.abs(directCost - sourceLineCost) ? packageCost : directCost;
    }

    if (packageCost !== null && pricebookUnitCostIsPackageCost(item)) {
      return packageCost;
    }

    return directCost;
  }

  function nestedRecipeLiveLineCost(recipe, qty, unit) {
    if (!recipe) return null;
    const totalCost = Number(recipe.totalCost);
    if (!Number.isFinite(totalCost) || totalCost < 0) return null;
    const yieldQty = Number(recipe.yieldQty);
    const safeYieldQty = Number.isFinite(yieldQty) && yieldQty > 0 ? yieldQty : 1;
    const qtyInYieldUnit =
      convertEditorQuantity(qty, unit || recipe.yieldUnit || "x", recipe.yieldUnit || "x") ?? qty;
    if (!Number.isFinite(qtyInYieldUnit)) return null;
    return (qtyInYieldUnit / safeYieldQty) * totalCost;
  }

  function updateRowLineCost(row) {
    const output = row.querySelector(".rb-line-cost");
    if (!output) return;
    const type = row.querySelector(".rb-line-type")?.value;
    if (type === "INGREDIENT") {
      const itemId = parseNullableNumber(row.querySelector(".rb-ingredient-item")?.value);
      const qty = parseNullableNumber(row.querySelector(".rb-qty")?.value);
      const unit = row.querySelector(".rb-unit")?.value || "";
      const noteText = row.querySelector(".rb-notes")?.value || "";
      if (!itemId || qty === null) {
        output.value = "n/a";
        return;
      }
      const item = optionItems.find((entry) => Number(entry.id) === Number(itemId));
      const live = ingredientLiveLineCost(item, qty, unit, noteText);
      output.value = lineCostDisplay({ lineCost: live });
      return;
    }
    if (type === "RECIPE") {
      const nestedId = parseNullableNumber(row.querySelector(".rb-ingredient-recipe")?.value);
      const qty = parseNullableNumber(row.querySelector(".rb-qty")?.value);
      const unit = row.querySelector(".rb-unit")?.value || "";
      if (!nestedId || qty === null) {
        output.value = "n/a";
        return;
      }
      const recipe = optionRecipes.find((entry) => Number(entry.id) === Number(nestedId));
      const live = nestedRecipeLiveLineCost(recipe, qty, unit);
      output.value = lineCostDisplay({ lineCost: live });
      return;
    }
    output.value = "n/a";
  }

  function renderLineBody(row, line = {}) {
    const type = row.querySelector(".rb-line-type").value;
    const body = row.querySelector(".recipe-line-body");

    if (type === "INGREDIENT") {
      body.innerHTML = `
        <label class="rb-field rb-main-field">
          <span>Ingredient</span>
          <select class="rb-ingredient-item">
            <option value="">Select item</option>
            ${itemOptionsHtml(line.ingredientItemId)}
          </select>
        </label>
        <label class="rb-field rb-qty-field">
          <span>Quantity</span>
          <input type="number" min="0" step="0.01" class="rb-qty" value="${escapeHtml(line.quantity ?? "")}" />
        </label>
        <label class="rb-field rb-unit-field">
          <span>Unit</span>
          <select class="rb-unit">${ingredientUnitOptions(line.ingredientItemId, line.unit || "")}</select>
        </label>
        <label class="rb-field rb-cost-field">
          <span>Line Cost</span>
          <input type="text" class="rb-line-cost" value="${escapeHtml(lineCostDisplay(line))}" readonly />
        </label>
        <label class="rb-field rb-notes-field">
          <span>Notes</span>
          <input type="text" class="rb-notes" value="${escapeHtml(line.notes ?? "")}" />
        </label>
      `;
      const itemSelect = body.querySelector(".rb-ingredient-item");
      const unitSelect = body.querySelector(".rb-unit");
      itemSelect?.addEventListener("change", () => {
        unitSelect.innerHTML = ingredientUnitOptions(itemSelect.value, "");
        updateRowLineCost(row);
      });
      body.querySelector(".rb-qty")?.addEventListener("input", () => updateRowLineCost(row));
      body.querySelector(".rb-unit")?.addEventListener("change", () => updateRowLineCost(row));
      body.querySelector(".rb-unit")?.addEventListener("input", () => updateRowLineCost(row));
      body.querySelector(".rb-notes")?.addEventListener("input", () => updateRowLineCost(row));
      updateRowLineCost(row);
      return;
    }

    if (type === "RECIPE") {
      body.innerHTML = `
        <label class="rb-field rb-main-field">
          <span>Recipe</span>
          <select class="rb-ingredient-recipe">
            <option value="">Select recipe</option>
            ${recipeOptionsHtml(line.ingredientRecipeId)}
          </select>
        </label>
        <label class="rb-field rb-qty-field">
          <span>Quantity</span>
          <input type="number" min="0" step="0.01" class="rb-qty" value="${escapeHtml(line.quantity ?? "1")}" />
        </label>
        <label class="rb-field rb-unit-field">
          <span>Unit</span>
          <input type="text" class="rb-unit" value="${escapeHtml(line.unit ?? "x")}" />
        </label>
        <label class="rb-field rb-cost-field">
          <span>Line Cost</span>
          <input type="text" class="rb-line-cost" value="${escapeHtml(lineCostDisplay(line))}" readonly />
        </label>
        <label class="rb-field rb-notes-field">
          <span>Notes</span>
          <input type="text" class="rb-notes" value="${escapeHtml(line.notes ?? "")}" />
        </label>
      `;
      body.querySelector(".rb-ingredient-recipe")?.addEventListener("change", () => updateRowLineCost(row));
      body.querySelector(".rb-qty")?.addEventListener("input", () => updateRowLineCost(row));
      body.querySelector(".rb-unit")?.addEventListener("input", () => updateRowLineCost(row));
      updateRowLineCost(row);
      return;
    }

    if (type === "DIRECTION") {
      body.innerHTML = `
        <label class="rb-field rb-wide-field">
          <span>Direction</span>
          <textarea class="rb-direction" rows="1">${escapeHtml(line.directionText ?? "")}</textarea>
        </label>
      `;
      return;
    }

    if (type === "COOK_TEMPERATURE") {
      body.innerHTML = `
        <label class="rb-field rb-main-field">
          <span>Temperature</span>
          <input type="number" min="0" step="0.1" class="rb-cook-temp" value="${escapeHtml(line.cookTemperature ?? "")}" />
        </label>
        <label class="rb-field rb-unit-field">
          <span>Unit</span>
          <input type="text" class="rb-cook-temp-unit" value="${escapeHtml(line.cookTemperatureUnit ?? "F")}" />
        </label>
        <label class="rb-field rb-notes-field rb-notes-wide-field">
          <span>Notes</span>
          <input type="text" class="rb-notes" value="${escapeHtml(line.notes ?? "")}" />
        </label>
      `;
      return;
    }

    if (type === "TIME") {
      body.innerHTML = `
        <label class="rb-field rb-main-field">
          <span>Time</span>
          <input type="number" min="0" step="0.1" class="rb-time-value" value="${escapeHtml(line.timeValue ?? "")}" />
        </label>
        <label class="rb-field rb-unit-field">
          <span>Unit</span>
          <input type="text" class="rb-time-unit" value="${escapeHtml(line.timeUnit ?? "minutes")}" />
        </label>
        <label class="rb-field rb-notes-field rb-notes-wide-field">
          <span>Notes</span>
          <input type="text" class="rb-notes" value="${escapeHtml(line.notes ?? "")}" />
        </label>
      `;
      return;
    }

    body.innerHTML = `
      <label class="rb-field rb-wide-field">
        <span>Note</span>
        <textarea class="rb-notes" rows="1">${escapeHtml(line.notes ?? "")}</textarea>
      </label>
    `;
  }

  function addRecipeLineRow(line = {}) {
    const row = document.createElement("div");
    row.className = "recipe-line";
    row.innerHTML = `
      <div class="recipe-line-grid">
        <label class="rb-field rb-line-type-field">
          <span>Line Type</span>
          <select class="rb-line-type">
            <option value="INGREDIENT">Ingredient</option>
            <option value="RECIPE">Recipe</option>
            <option value="DIRECTION">Direction</option>
            <option value="COOK_TEMPERATURE">Cook Temperature</option>
            <option value="TIME">Time</option>
            <option value="NOTE">Note</option>
          </select>
        </label>
        <div class="recipe-line-body"></div>
        <button type="button" class="secondary mini-btn rb-remove-line">Remove</button>
      </div>
    `;

    const typeSelect = row.querySelector(".rb-line-type");
    typeSelect.value = line.lineType || "INGREDIENT";
    typeSelect.addEventListener("change", () => renderLineBody(row));
    row.querySelector(".rb-remove-line").addEventListener("click", () => row.remove());

    renderLineBody(row, line);
    recipeLines.appendChild(row);
    applyEditorReadOnlyState();
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
    optionYields = opts.yields || [];
  }

  async function openRecipe(recipeId) {
    setEditorOnlyMode(true);
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
    if (editorUnitCost) editorUnitCost.textContent = `Cost / yield: ${costPerYieldDisplay(recipe)}`;
    editorTitle.textContent = `${isViewMode ? "Recipe View" : "Recipe Editor"}: ${recipe.name}`;

    recipeLines.innerHTML = "";
    for (const line of recipe.lines || []) addRecipeLineRow(line);
    editorCard.hidden = false;
    applyEditorReadOnlyState();
    editorCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function loadRecipes() {
    setEditorOnlyMode(false);
    recipes = await api("/api/recipe-builder/recipes");
    recipeListLoaded = true;
    if (!recipes.length) {
      recipeList.innerHTML = "<p>No recipes yet.</p>";
      return;
    }

    recipeList.innerHTML = `
      <table>
        <thead><tr><th>Name</th><th>Category</th><th>Status</th><th>Batch Cost</th><th>Yield Cost</th><th>Action</th></tr></thead>
        <tbody>
          ${recipes
            .map(
              (recipe) => `<tr>
                <td>${recipe.name}</td>
                <td>${recipe.category || ""}</td>
                <td>${recipe.status || ""}</td>
                <td>$${Number(recipe.totalCost || 0).toFixed(2)}</td>
                <td>${costPerYieldDisplay(recipe)}</td>
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

  saveRecipeMeta.addEventListener("click", async () => {
    if (isViewMode) return;
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
      if (recipeListLoaded && !recipeListCard?.hidden) await loadRecipes();
      editorTitle.textContent = `Recipe Editor: ${editorRecipeName.value.trim()}`;
      showToast("Recipe header saved.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  saveRecipeLines.addEventListener("click", async () => {
    if (isViewMode) return;
    try {
      const id = Number(editorRecipeId.value);
      await api(`/api/recipe-builder/recipes/${id}/lines`, {
        method: "PUT",
        body: JSON.stringify({ lines: collectLinesPayload() }),
      });
      if (recipeListLoaded && !recipeListCard?.hidden) await loadRecipes();
      await openRecipe(id);
      showToast("Recipe lines saved.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  addRecipeLine.addEventListener("click", () => {
    if (isViewMode) return;
    addRecipeLineRow();
  });

  if (switchToEdit) {
    switchToEdit.addEventListener("click", () => {
      const id = Number(editorRecipeId.value || pageParams.get("recipeId") || 0);
      if (!Number.isInteger(id) || id <= 0) {
        showToast("Select a recipe first.", true);
        return;
      }
      window.location.href = `/recipe-builder?recipeId=${encodeURIComponent(id)}`;
    });
  }

  const presetRecipeId = Number(pageParams.get("recipeId") || 0);
  if (Number.isInteger(presetRecipeId) && presetRecipeId > 0) {
    await openRecipe(presetRecipeId);
  } else {
    await loadRecipes();
  }
}

async function initAdminReferencePage() {
  const conversionsContainer = byId("admin-conversions");
  const conversionInputsContainer = byId("conversion-inputs");
  const conversionInputsHelp = byId("conversion-inputs-help");
  const yieldsOptionButton = byId("conversion-option-yields");
  const densitiesOptionButton = byId("conversion-option-densities");
  const unmatchedSourcesContainer = byId("unmatched-sources");
  const refreshUnmatchedSourcesButton = byId("refresh-unmatched-sources");
  const addConversionButton = byId("add-conversion");
  const refreshConversionsButton = byId("refresh-conversions");
  const refreshConversionInputsButton = byId("refresh-conversion-inputs");
  if (
    !conversionsContainer ||
    !conversionInputsContainer ||
    !conversionInputsHelp ||
    !yieldsOptionButton ||
    !densitiesOptionButton ||
    !unmatchedSourcesContainer ||
    !refreshUnmatchedSourcesButton ||
    !refreshConversionsButton ||
    !refreshConversionInputsButton
  ) {
    return;
  }

  let activeConversionInput = "yields";
  let itemOptionsCache = [];

  function defaultBaseUnitByType(type) {
    const t = String(type || "").toLowerCase();
    if (t === "volume") return "fl oz";
    if (t === "weight") return "g";
    if (t === "count") return "ea";
    return "";
  }

  async function loadConversions() {
    const rows = await api("/api/admin/conversions");
    if (!rows.length) {
      conversionsContainer.innerHTML = "<p>No conversions found.</p>";
      return;
    }

    conversionsContainer.innerHTML = `
      <div class="table-scroll">
      <table>
        <thead><tr><th>Unit</th><th>Type</th><th>Base Definition (1 Unit = ?)</th><th>Action</th><th>Remove</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (row) => `
            <tr data-conv-id="${row.id}">
              <td><input type="text" class="ad-conv-unit" value="${row.unit}" /></td>
              <td><input type="text" class="ad-conv-type" value="${row.unitType}" /></td>
              <td>
                <div class="line">
                  <span>1</span>
                  <input type="number" step="0.0001" min="0.0001" class="ad-conv-base" value="${row.toBase ?? ""}" />
                  <span>x</span>
                  <input type="text" class="ad-conv-base-unit" value="${row.baseUnit ?? ""}" placeholder="fl oz, g, ea..." />
                </div>
              </td>
              <td><button type="button" class="secondary mini-btn ad-conv-save">Save</button></td>
              <td><button type="button" class="secondary mini-btn ad-conv-delete">Delete</button></td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
      </div>
    `;

    conversionsContainer.querySelectorAll(".ad-conv-save").forEach((button) => {
      button.addEventListener("click", async () => {
        const tr = button.closest("tr");
        const id = Number(tr.dataset.convId);
        try {
          const typeValue = tr.querySelector(".ad-conv-type").value.trim();
          const baseUnitInput = tr.querySelector(".ad-conv-base-unit");
          const baseUnitValue = baseUnitInput.value.trim() || defaultBaseUnitByType(typeValue);
          await api(`/api/admin/conversions/${id}`, {
            method: "PUT",
            body: JSON.stringify({
              unit: tr.querySelector(".ad-conv-unit").value.trim(),
              unitType: typeValue,
              baseUnit: baseUnitValue,
              toBase: Number(tr.querySelector(".ad-conv-base").value),
            }),
          });
          baseUnitInput.value = baseUnitValue;
          showToast("Conversion saved.");
        } catch (error) {
          showToast(error.message, true);
        }
      });
    });

    conversionsContainer.querySelectorAll(".ad-conv-delete").forEach((button) => {
      button.addEventListener("click", async () => {
        const tr = button.closest("tr");
        const id = Number(tr.dataset.convId);
        try {
          await api(`/api/admin/conversions/${id}`, { method: "DELETE" });
          await loadConversions();
          showToast("Conversion deleted.");
        } catch (error) {
          showToast(error.message, true);
        }
      });
    });
  }

  async function loadYields() {
    const rows = await api("/api/admin/yields");
    if (!rows.length) {
      conversionInputsContainer.innerHTML = "<p>No yields found.</p>";
      return;
    }

    conversionInputsContainer.innerHTML = `
      <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Product</th><th>Source</th><th>Purchase Unit</th><th>Source Price</th>
            <th>Yield Unit</th><th>Yield Value</th><th>Price / Yield</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
            <tr data-yield-id="${row.id}">
              <td><input type="text" class="ad-y-product" value="${row.productName}" /></td>
              <td><input type="text" class="ad-y-source" value="${row.sourceIngredient}" /></td>
              <td><input type="text" class="ad-y-punit" value="${row.purchaseUnit}" /></td>
              <td><input type="number" step="0.0001" min="0" class="ad-y-sprice" value="${row.sourcePerPrice ?? ""}" /></td>
              <td><input type="text" class="ad-y-yunit" value="${row.yieldUnit}" /></td>
              <td><input type="number" step="0.0001" min="0" class="ad-y-yvalue" value="${row.yieldValue ?? ""}" /></td>
              <td><input type="number" step="0.0001" min="0" class="ad-y-pyield" value="${row.pricePerYieldUnit ?? ""}" /></td>
              <td><button type="button" class="secondary mini-btn ad-y-save">Save</button></td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
      </div>
    `;

    conversionInputsContainer.querySelectorAll(".ad-y-save").forEach((button) => {
      button.addEventListener("click", async () => {
        const tr = button.closest("tr");
        const id = Number(tr.dataset.yieldId);
        try {
          await api(`/api/admin/yields/${id}`, {
            method: "PUT",
            body: JSON.stringify({
              productName: tr.querySelector(".ad-y-product").value.trim(),
              sourceIngredient: tr.querySelector(".ad-y-source").value.trim(),
              purchaseUnit: tr.querySelector(".ad-y-punit").value.trim(),
              sourcePerPrice: parseNullableNumber(tr.querySelector(".ad-y-sprice").value),
              yieldUnit: tr.querySelector(".ad-y-yunit").value.trim(),
              yieldValue: parseNullableNumber(tr.querySelector(".ad-y-yvalue").value),
              pricePerYieldUnit: parseNullableNumber(tr.querySelector(".ad-y-pyield").value),
              key: "",
              verifiedBy: "",
              verifiedDate: "",
              notes: "",
            }),
          });
          showToast("Yield saved.");
        } catch (error) {
          showToast(error.message, true);
        }
      });
    });
  }

  async function loadDensities() {
    const rows = await api("/api/admin/densities");
    if (!rows.length) {
      conversionInputsContainer.innerHTML = "<p>No densities found.</p>";
      return;
    }

    conversionInputsContainer.innerHTML = `
      <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Ingredient</th><th>Grams / Cup</th><th>Cups / Lb</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
            <tr data-density-id="${row.id}">
              <td><input type="text" class="ad-d-ingredient" value="${row.ingredientName}" /></td>
              <td><input type="number" step="0.0001" min="0" class="ad-d-gpc" value="${row.gramsPerCup ?? ""}" /></td>
              <td><input type="number" step="0.0001" min="0" class="ad-d-cplb" value="${row.cupsPerLb ?? ""}" /></td>
              <td><button type="button" class="secondary mini-btn ad-d-save">Save</button></td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
      </div>
    `;

    conversionInputsContainer.querySelectorAll(".ad-d-save").forEach((button) => {
      button.addEventListener("click", async () => {
        const tr = button.closest("tr");
        const id = Number(tr.dataset.densityId);
        try {
          await api(`/api/admin/densities/${id}`, {
            method: "PUT",
            body: JSON.stringify({
              ingredientName: tr.querySelector(".ad-d-ingredient").value.trim(),
              gramsPerCup: parseNullableNumber(tr.querySelector(".ad-d-gpc").value),
              cupsPerLb: parseNullableNumber(tr.querySelector(".ad-d-cplb").value),
            }),
          });
          showToast("Density saved.");
        } catch (error) {
          showToast(error.message, true);
        }
      });
    });
  }

  async function loadItemOptions() {
    const rows = await api("/api/items");
    itemOptionsCache = rows
      .map((row) => ({
        id: Number(row.id),
        label: `${row.name} (${row.vendor?.name || "Unknown Vendor"})`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  function itemSelectHtml(selectClass, selectedId = null) {
    const options = itemOptionsCache
      .map((item) => {
        const selected = Number(selectedId) === Number(item.id) ? "selected" : "";
        return `<option value="${item.id}" ${selected}>${item.label}</option>`;
      })
      .join("");
    return `<select class="${selectClass}"><option value="">Select item...</option>${options}</select>`;
  }

  async function loadUnmatchedSources() {
    if (!itemOptionsCache.length) {
      await loadItemOptions();
    }
    const rows = await api("/api/admin/unmatched-sources");
    if (!rows.length) {
      unmatchedSourcesContainer.innerHTML = "<p>No unmatched sources.</p>";
      return;
    }

    unmatchedSourcesContainer.innerHTML = `
      <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Source</th><th>Count</th><th>Examples</th><th>Map To Item</th><th>Action</th><th>Placeholder</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((row, idx) => {
              const examples = (row.examples || [])
                .map((ex) => `${ex.category}/${ex.recipeName} #${ex.sortOrder} (${ex.quantity ?? ""} ${ex.unit || ""})`)
                .join("<br/>");
              return `
                <tr data-source="${encodeURIComponent(String(row.source || ""))}">
                  <td>${row.source}</td>
                  <td>${row.count}</td>
                  <td>${examples || "n/a"}</td>
                  <td>${itemSelectHtml(`ad-unmatched-item-${idx}`, row.suggestedItemId)}</td>
                  <td><button type="button" class="secondary mini-btn ad-unmatched-map" data-select-class="ad-unmatched-item-${idx}">Map</button></td>
                  <td><button type="button" class="secondary mini-btn ad-unmatched-create">Create + Map</button></td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
      </div>
    `;

    unmatchedSourcesContainer.querySelectorAll(".ad-unmatched-map").forEach((button) => {
      button.addEventListener("click", async () => {
        const tr = button.closest("tr");
        const source = decodeURIComponent(tr.dataset.source || "");
        const selectClass = button.dataset.selectClass;
        const select = tr.querySelector(`.${selectClass}`);
        const itemId = parseNullableNumber(select?.value);
        try {
          await api("/api/admin/unmatched-sources/map", {
            method: "POST",
            body: JSON.stringify({
              source,
              itemId,
              createPlaceholder: false,
            }),
          });
          await loadUnmatchedSources();
          showToast(`Mapped ${source}.`);
        } catch (error) {
          showToast(error.message, true);
        }
      });
    });

    unmatchedSourcesContainer.querySelectorAll(".ad-unmatched-create").forEach((button) => {
      button.addEventListener("click", async () => {
        const tr = button.closest("tr");
        const source = decodeURIComponent(tr.dataset.source || "");
        try {
          await api("/api/admin/unmatched-sources/map", {
            method: "POST",
            body: JSON.stringify({
              source,
              createPlaceholder: true,
            }),
          });
          await loadItemOptions();
          await loadUnmatchedSources();
          showToast(`Created placeholder and mapped ${source}.`);
          window.dispatchEvent(new CustomEvent("catalog-data-changed"));
        } catch (error) {
          showToast(error.message, true);
        }
      });
    });
  }

  function setConversionOption(option) {
    activeConversionInput = option;
    setAreaToggleState(option, [
      { area: "yields", button: yieldsOptionButton },
      { area: "densities", button: densitiesOptionButton },
    ]);

    if (option === "yields") {
      conversionInputsHelp.textContent =
        "Yield defines usable output from a purchased input (for example, trimmed produce, reduced syrup, or cooked batch). It helps recipe costing convert buy-units into recipe-ready units.";
      loadYields().catch((e) => showToast(e.message, true));
      return;
    }

    conversionInputsHelp.textContent =
      "Density defines weight-to-volume behavior (for example, grams per cup) so recipes can accurately convert between volume and weight while costing and scaling.";
    loadDensities().catch((e) => showToast(e.message, true));
  }

  refreshConversionsButton.addEventListener("click", () =>
    loadConversions().catch((e) => showToast(e.message, true))
  );
  refreshConversionInputsButton.addEventListener("click", () => {
    if (activeConversionInput === "yields") {
      loadYields().catch((e) => showToast(e.message, true));
      return;
    }
    loadDensities().catch((e) => showToast(e.message, true));
  });
  refreshUnmatchedSourcesButton.addEventListener("click", () =>
    loadUnmatchedSources().catch((e) => showToast(e.message, true))
  );
  yieldsOptionButton.addEventListener("click", () => setConversionOption("yields"));
  densitiesOptionButton.addEventListener("click", () => setConversionOption("densities"));

  if (addConversionButton) {
    addConversionButton.addEventListener("click", async () => {
      try {
        await api("/api/admin/conversions", {
          method: "POST",
          body: JSON.stringify({
            unit: `new_unit_${Date.now()}`,
            unitType: "volume",
            baseUnit: "fl oz",
            toBase: 1,
          }),
        });
        await loadConversions();
        showToast("Conversion added.");
      } catch (error) {
        showToast(error.message, true);
      }
    });
  }

  await loadConversions();
  setConversionOption("yields");
  await loadUnmatchedSources();
}

async function initRecipeBooksPage() {
  const tableContainer = byId("recipe-book-table");
  const title = byId("recipe-book-title");
  const refresh = byId("recipe-book-refresh");
  const prep = byId("recipe-book-prep");
  const final = byId("recipe-book-final");
  const syrup = byId("recipe-book-syrup");
  const drinks = byId("recipe-book-drinks");
  if (!tableContainer || !title || !refresh || !prep || !final || !syrup || !drinks) return;

  let activeBook = "Prep";

  function recipeBookYieldText(row) {
    const qty = Number(row.yieldQty);
    const unit = String(row.yieldUnit || "").trim();
    if (!Number.isFinite(qty) || qty <= 0) return unit || "n/a";
    return `${Number(qty.toFixed(4))}${unit ? ` ${unit}` : ""}`;
  }

  function setBook(book) {
    activeBook = book;
    title.textContent = `${book} Recipes`;
    setAreaToggleState(book, [
      { area: "Prep", button: prep },
      { area: "Final", button: final },
      { area: "Syrup", button: syrup },
      { area: "Drinks", button: drinks },
    ]);
  }

  async function loadBook() {
    const rows = await api(`/api/recipe-books?book=${encodeURIComponent(activeBook)}`);
    if (!rows.length) {
      tableContainer.innerHTML = `<p>No recipes in ${activeBook}.</p>`;
      return;
    }

    tableContainer.innerHTML = `
      <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Recipe</th>
            <th>Yield</th>
            <th>Unit Cost</th>
            <th>Batch Cost</th>
            <th>Retail Price</th>
            <th>Margin %</th>
            <th>Profit</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
            <tr data-recipe-id="${row.recipeId}" data-recipe-name="${encodeURIComponent(row.recipeName)}">
              <td>${row.recipeName}</td>
              <td>${recipeBookYieldText(row)}</td>
              <td>$${Number(row.cost ?? 0).toFixed(2)}</td>
              <td>$${Number(row.batchCost ?? row.cost ?? 0).toFixed(2)}</td>
              <td><input type="number" min="0" step="0.01" class="rb-retail" value="${row.retailPrice ?? ""}" /></td>
              <td>${row.marginPercent === null ? "n/a" : `${Number(row.marginPercent).toFixed(2)}%`}</td>
              <td>${row.profit === null ? "n/a" : `$${Number(row.profit).toFixed(2)}`}</td>
              <td>
                <select class="rb-action-select">
                  <option value="">Choose Action</option>
                  <option value="view">View</option>
                  <option value="edit">Edit</option>
                  <option value="save">Save</option>
                </select>
              </td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
      </div>
    `;

    tableContainer.querySelectorAll(".rb-action-select").forEach((select) => {
      select.addEventListener("change", async () => {
        const action = select.value;
        if (!action) return;
        select.value = "";
        select.disabled = true;

        const tr = select.closest("tr");
        const recipeId = Number(tr.dataset.recipeId);
        const recipeName = decodeURIComponent(tr.dataset.recipeName);
        try {
          if (action === "save") {
            const retailPrice = parseNullableNumber(tr.querySelector(".rb-retail").value);
            await api(`/api/recipe-books/${encodeURIComponent(activeBook)}/${encodeURIComponent(recipeName)}/retail`, {
              method: "PUT",
              body: JSON.stringify({ retailPrice }),
            });
            await loadBook();
            showToast("Retail price saved.");
            return;
          }

          if (action === "edit" || action === "view") {
            if (!Number.isInteger(recipeId) || recipeId <= 0) {
              throw new Error("Recipe id not found.");
            }
            const query = action === "view" ? `?recipeId=${encodeURIComponent(recipeId)}&mode=view` : `?recipeId=${encodeURIComponent(recipeId)}`;
            window.location.href = `/recipe-builder${query}`;
            return;
          }
        } catch (error) {
          showToast(error.message, true);
        } finally {
          select.disabled = false;
        }
      });
    });
  }

  prep.addEventListener("click", () => {
    setBook("Prep");
    loadBook().catch((e) => showToast(e.message, true));
  });
  final.addEventListener("click", () => {
    setBook("Final");
    loadBook().catch((e) => showToast(e.message, true));
  });
  syrup.addEventListener("click", () => {
    setBook("Syrup");
    loadBook().catch((e) => showToast(e.message, true));
  });
  drinks.addEventListener("click", () => {
    setBook("Drinks");
    loadBook().catch((e) => showToast(e.message, true));
  });
  refresh.addEventListener("click", () => loadBook().catch((e) => showToast(e.message, true)));

  setBook("Prep");
  await loadBook();
}

async function init() {
  await initLoginPage();
  if (byId("login-form")) return;
  await loadCurrentUser();
  await initSecurityPage();
  await initVendorPage();
  await initAddItemPage();
  await initItemCatalogPage();
  await initAreasPage();
  await initCountsPage();
  await initParLevelsPage();
  await initReorderPage();
  await initRecipeCreatePage();
  await initRecipeBuilderPage();
  await initAdminReferencePage();
  await initRecipeBooksPage();
}

init().catch((error) => showToast(error.message, true));
