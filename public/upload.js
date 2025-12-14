// upload.js - Client-side upload handler with validation + STAGE SCAN OBAT steps
const form = document.getElementById('scanForm');
const thumbContainer = document.getElementById('thumbContainer');
const loadingOverlay = document.getElementById('loadingOverlay');

const stagePanel = document.getElementById('stagePanel');
const confirmStageBtn = document.getElementById('confirmStageBtn');
const resetStageBtn = document.getElementById('resetStageBtn');
const drugNameInput = document.getElementById('drugName');
const drugVariantInput = document.getElementById('drugVariant');
const uploadGrid = document.getElementById('uploadGrid');
const modelSummary = document.getElementById('modelSummary');
const modelJsonPre = document.getElementById('modelJson');
const unavailablePanel = document.getElementById('unavailablePanel');
const requestBrandBtn = document.getElementById('requestBrandBtn');
const requestStatus = document.getElementById('requestStatus');

let stageConfirmed = false;
let modelsData = {};
let selectedModel = null;

// Load models list from server (public/models.json)
fetch('/models.json').then(r => r.json()).then(json => {
  modelsData = json || {};
  // Populate datalist for brand suggestions
  const brandsDatalist = document.getElementById('brandsList');
  Object.keys(modelsData).forEach(brand => {
    const opt = document.createElement('option');
    opt.value = brand;
    brandsDatalist.appendChild(opt);
  });
}).catch(err => {
  console.error('Failed to load models.json', err);
});

// When brand typed/changed, populate variants if available; show "obat tidak tersedia" otherwise
drugNameInput.addEventListener('input', () => {
  const brand = (drugNameInput.value || '').trim();
  drugVariantInput.innerHTML = '<option value="">-- Pilih varian --</option>';
  modelSummary.style.display = 'none';
  selectedModel = null;
  if (!brand) {
    drugVariantInput.disabled = true;
    return;
  }
  const variants = modelsData[brand] || null;
  if (!variants) {
    // brand not available
    drugVariantInput.disabled = true;
    modelJsonPre.textContent = 'Obat tidak tersedia';
    // show unavailable panel
    if (unavailablePanel) unavailablePanel.style.display = '';
    if (modelJsonPre) modelJsonPre.style.display = 'none';
    modelSummary.style.display = '';
    selectedModel = null;
    return;
  }
  // populate variants
  Object.keys(variants).forEach(v => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    drugVariantInput.appendChild(o);
  });
  drugVariantInput.disabled = false;
  // hide unavailable if shown
  if (unavailablePanel) unavailablePanel.style.display = 'none';
  if (modelJsonPre) modelJsonPre.style.display = '';
});

// Show model summary when variant selected
drugVariantInput.addEventListener('change', () => {
  const brand = drugNameInput.value;
  const variant = drugVariantInput.value;
  if (!brand || !variant) {
    modelSummary.style.display = 'none';
    selectedModel = null;
    return;
  }
  const model = (modelsData[brand] && modelsData[brand][variant]) ? modelsData[brand][variant] : null;
  if (!model) {
    modelSummary.style.display = 'none';
    selectedModel = null;
    alert('Model untuk kombinasi yang dipilih tidak ditemukan. Silakan pilih varian lain.');
    return;
  }
  selectedModel = model;
  modelJsonPre.textContent = JSON.stringify(model, null, 2);
  // ensure model JSON visible and unavailable panel hidden
  if (unavailablePanel) unavailablePanel.style.display = 'none';
  if (modelJsonPre) modelJsonPre.style.display = '';
  modelSummary.style.display = '';
});

// Update previews when files selected
document.querySelectorAll('input[type="file"]').forEach(inp => {
  inp.addEventListener('change', updateThumbs);
});

// Stage confirm: ensure drug name and variant provided before enabling uploads
confirmStageBtn.addEventListener('click', (e) => {
  e.preventDefault();
  const name = (drugNameInput.value || '').trim();
  const variant = (drugVariantInput.value || '').trim();
  if (!name) {
    alert('Silakan isi nama obat. Contoh: Panadol, Bodrex, Paracetamol');
    drugNameInput.focus();
    return;
  }
  // Ensure brand exists in models
  const brandModels = modelsData[name] || null;
  if (!brandModels) {
    alert('Obat tidak tersedia');
    drugNameInput.focus();
    return;
  }
  if (!variant) {
    alert('Silakan isi jenis atau varian obat. Contoh: Panadol Extra, Panadol Cold & Flu');
    drugVariantInput.focus();
    return;
  }

  // Ensure selected model exists
  const model = brandModels[variant] || null;
  if (!model) {
    alert('Model untuk kombinasi yang dipilih tidak ditemukan. Silakan pilih varian lain.');
    drugVariantInput.focus();
    return;
  }

  // Mark stage confirmed, reveal upload UI and enable inputs
  stageConfirmed = true;
  stagePanel.style.display = 'none';
  uploadGrid.style.display = '';
  document.querySelectorAll('input[type="file"]').forEach(inp => inp.disabled = false);
  // Focus first file input
  const firstFile = document.querySelector('input[type="file"]');
  if (firstFile) firstFile.focus();
});

// Brand request button handler
if (requestBrandBtn) {
  requestBrandBtn.addEventListener('click', async (ev) => {
    ev.preventDefault();
    const brand = (drugNameInput.value || '').trim();
    if (!brand) return;
    requestStatus.textContent = 'Mengirim permintaan...';
    requestBrandBtn.disabled = true;
    try {
      const resp = await fetch('/api/brand-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand })
      });
      if (resp.ok) {
        requestStatus.textContent = 'Permintaan terkirim. Terima kasih!';
      } else {
        const j = await resp.json().catch(() => ({}));
        requestStatus.textContent = j.message || 'Gagal mengirim permintaan.';
        requestBrandBtn.disabled = false;
      }
    } catch (err) {
      console.error('Request error', err);
      requestStatus.textContent = 'Gagal mengirim. Coba lagi nanti.';
      requestBrandBtn.disabled = false;
    }
  });
}

resetStageBtn.addEventListener('click', (e) => {
  e.preventDefault();
  drugNameInput.value = '';
  drugVariantInput.innerHTML = '<option value="">-- Pilih varian --</option>';
  drugVariantInput.disabled = true;
  modelSummary.style.display = 'none';
  if (unavailablePanel) unavailablePanel.style.display = 'none';
  if (modelJsonPre) modelJsonPre.style.display = '';
  selectedModel = null;
  drugNameInput.focus();
});

function updateThumbs() {
  thumbContainer.innerHTML = '';
  document.querySelectorAll('input[type="file"]').forEach(inp => {
    if (inp.files && inp.files[0]) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(inp.files[0]);
      img.className = 'thumb';
      img.onload = () => URL.revokeObjectURL(img.src);
      thumbContainer.appendChild(img);
    }
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  // Ensure stage completed
  if (!stageConfirmed) {
    alert('Silakan isi nama obat dan varian terlebih dahulu sebelum mengunggah foto.');
    return;
  }

  // Validate files
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  const files = {};
  let valid = true;

  document.querySelectorAll('input[type="file"]').forEach(inp => {
    if (!inp.files || !inp.files[0]) {
      alert(`${inp.name} harus diisi`);
      valid = false;
      return;
    }
    const file = inp.files[0];
    if (file.size > 5 * 1024 * 1024) {
      alert(`Ukuran file terlalu besar — maksimal 5MB per foto. (${inp.name}: ${(file.size / 1024 / 1024).toFixed(1)}MB)`);
      valid = false;
      return;
    }
    if (!allowed.includes(file.type)) {
      alert(`Format file tidak didukung untuk ${inp.name} — gunakan JPG, PNG, atau WebP.`);
      valid = false;
      return;
    }
    files[inp.name] = file;
  });

  if (!valid) return;

  // Show loading
  loadingOverlay.classList.add('show');

  try {
    const fd = new FormData();
    // Attach drug metadata (part of STAGE SCAN OBAT)
    fd.append('drug_name', drugNameInput.value.trim());
    fd.append('drug_variant', drugVariantInput.value.trim());
    Object.entries(files).forEach(([key, file]) => fd.append(key, file));

    const res = await fetch('/api/scan', { method: 'POST', body: fd });

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.message || `Upload failed with status ${res.status}`);
    }

    const json = await res.json();
    const scanId = json.scanId;

    // Poll for status
    let completed = false;
    let attempts = 0;
    const maxAttempts = 120; // 2 minutes max wait (120 * 1 second)

    while (!completed && attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 1000));
      attempts++;

      try {
        const statusRes = await fetch(`/api/scan/${scanId}/status`);
        if (!statusRes.ok) throw new Error('Status check failed');

        const statusJson = await statusRes.json();
        if (statusJson.status === 'completed') {
          completed = true;
          window.location.href = `/results.html?scanId=${scanId}`;
        } else if (statusJson.status === 'failed') {
          throw new Error('Analisis gagal. Silakan coba lagi.');
        }
      } catch (err) {
        console.error('Status check error:', err);
      }
    }

    if (!completed) {
      throw new Error('Timeout: analisis memakan waktu terlalu lama.');
    }
  } catch (err) {
    alert(err.message || 'Gagal mengunggah atau memproses. Periksa koneksi dan coba lagi.');
  } finally {
    loadingOverlay.classList.remove('show');
  }
});
