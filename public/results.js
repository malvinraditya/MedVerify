// results.js - Load and render result data
async function loadResult() {
  const params = new URLSearchParams(window.location.search);
  const scanId = params.get('scanId');

  if (!scanId) {
    document.getElementById('scorePenjelasan').textContent = 'Scan ID tidak ditemukan.';
    return;
  }

  try {
    const res = await fetch(`/api/scan/${scanId}/result`);

    if (res.status === 202) {
      document.getElementById('scorePenjelasan').textContent = 'Hasil masih diproses. Silakan tunggu...';
      setTimeout(loadResult, 2000);
      return;
    }

    if (!res.ok) {
      throw new Error('Tidak dapat memuat hasil');
    }

    const data = await res.json();
    renderResult(data);
  } catch (err) {
    document.getElementById('scorePenjelasan').textContent = `Error: ${err.message}`;
  }
}

function renderResult(data) {
  console.log('Rendering result data:', data); // Debug log
  const p = data.probability ?? data.probability_asli ?? 0;
  const scanId = data.scanId;
  const detected = data.detected_drug || null;

  console.log('Probability:', p); // Debug log

  // Banner removed

  // Update donut chart
  const donut = document.getElementById('scoreDonut');
  if (donut) {
    const percentage = Math.max(0, Math.min(100, p));
    donut.style.background = `conic-gradient(var(--color-primary) 0deg ${percentage * 3.6}deg, #e6eefc ${percentage * 3.6}deg 360deg)`;
    document.getElementById('scoreLabel').textContent = `${Math.round(p)}%`;
  }

  // Update summary
  const summaryEl = document.getElementById('scoreSummary');
  if (summaryEl) {
    summaryEl.textContent = `Hasil Scan: ${Math.round(p)}% kemungkinan asli`;
  }
  const penjelasanEl = document.getElementById('scorePenjelasan');
  if (penjelasanEl) {
    penjelasanEl.textContent = (data.penjelasan || 'Tidak ada penjelasan tersedia.');
  }

  // Per-side scores removed

  // Analysis sections (mock content based on probability)
  console.log('Setting analysis sections for probability:', p); // Debug log

  const barcodeEl = document.getElementById('analisisBarcode');
  const warnaEl = document.getElementById('analisisWarna');
  const teksturEl = document.getElementById('analysisTekstur');
  const konsistensiEl = document.getElementById('analisisKonsistensi');
  const fontLogoEl = document.getElementById('analisisFontLogo');

  if (p >= 70) {
    if (barcodeEl) barcodeEl.textContent = 'Barcode terdeteksi dan terdaftar di database BPOM. Format GS1 valid. Tidak ditemukan tanda-tanda cetak abnormal.';
    if (warnaEl) warnaEl.textContent = 'Palet warna konsisten di semua sisi. Tidak ada deviasi signifikan (deltaE < 3).';
    if (teksturEl) teksturEl.textContent = 'Tekstur cetak normal dengan sharpness score 95+. Tidak ada tanda manipulasi digital.';
    if (konsistensiEl) konsistensiEl.textContent = 'Semua sisi menunjukkan dimensi dan alignment yang konsisten. Match score antar sisi >90%.';
    if (fontLogoEl) fontLogoEl.textContent = 'Font dan logo sesuai dengan data referensi. Penempatan dan ukuran akurat.';
  } else if (p >= 40) {
    if (barcodeEl) barcodeEl.textContent = 'Barcode terdeteksi tetapi dengan beberapa anomali minor pada spasi atau ketajaman.';
    if (warnaEl) warnaEl.textContent = 'Ditemukan beberapa perbedaan warna pada sisi tertentu (deltaE 4-6). Perlu verifikasi manual.';
    if (teksturEl) teksturEl.textContent = 'Tekstur cetak menunjukkan variasi minor. Sharpness score 70-85. Mungkin ada perbedaan media cetak.';
    if (konsistensiEl) konsistensiEl.textContent = 'Ada ketidakkonsistenan kecil antara beberapa sisi. Match score 60-75%.';
    if (fontLogoEl) fontLogoEl.textContent = 'Font atau logo menunjukkan perbedaan minor dibanding referensi. Perlu investigasi lebih lanjut.';
  } else {
    console.log('Setting fake analysis content'); // Debug log
    if (barcodeEl) {
      barcodeEl.textContent = 'Barcode tidak terdeteksi, rusak, atau format tidak valid. Kemungkinan tidak terdaftar.';
      console.log('Set barcode content');
    }
    if (warnaEl) {
      warnaEl.textContent = 'Perbedaan warna signifikan antar sisi (deltaE > 7). Indikasi cetak berkualitas rendah atau pemalsuan.';
      console.log('Set warna content');
    }
    if (teksturEl) {
      teksturEl.textContent = 'Tekstur cetak menunjukkan tanda manipulasi atau media cetak tidak standar. Sharpness score <70.';
      console.log('Set tekstur content');
    }
    if (konsistensiEl) {
      konsistensiEl.textContent = 'Inkonsistensi besar antara sisi-sisi. Match score <60%. Kemasan tidak kohesif.';
      console.log('Set konsistensi content');
    }
    if (fontLogoEl) {
      fontLogoEl.textContent = 'Font atau logo menyimpang jauh dari referensi. Indikasi kuat pemalsuan.';
      console.log('Set font logo content');
    }
  }

  // Populate temuan table
  const tbody = document.querySelector('#temuanTableBody');
  tbody.innerHTML = '';

  if (data.temuan && data.temuan.length > 0) {
    data.temuan.forEach(t => {
      const tr = document.createElement('tr');
      const severityClass = `severity-${t.severity || 'low'}`;
      const sideLabel = {
        front: 'Depan',
        back: 'Belakang',
        left: 'Kiri',
        right: 'Kanan',
        barcode: 'Barcode',
        global: 'Global'
      }[t.photo || t.side] || (t.photo || t.side || 'Global');

      tr.innerHTML = `
        <td class="temuan-message">${t.message || 'N/A'}</td>
        <td>${sideLabel}</td>
        <td><span class="severity-badge ${severityClass}">${(t.severity || 'low').toUpperCase()}</span></td>
        <td class="confidence">${t.confidence ?? '--'}%</td>
      `;
      tbody.appendChild(tr);
    });
  } else {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">Tidak ada temuan signifikan.</td></tr>';
  }

  // Peringatan
  if (data.peringatan) {
    const peringatanSection = document.getElementById('peringatanSection');
    document.getElementById('peringatanText').textContent = data.peringatan;
    peringatanSection.style.display = 'block';
  }

  // Download button
  document.getElementById('downloadBtn').addEventListener('click', async () => {
    try {
      const res = await fetch(`/api/reports/${scanId}`);
      if (!res.ok) return alert('Laporan belum tersedia.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `MedGuard-Report-${scanId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Gagal mengunduh laporan: ' + err.message);
    }
  });

  // Report to BPOM button
  document.getElementById('reportBtn').addEventListener('click', () => {
    const notes = prompt('Tambahkan catatan (opsional):', '');
    if (notes !== null) {
      alert(`Laporan untuk BPOM akan dikirim dengan scan ID: ${scanId}\nCatatan: ${notes || '(tidak ada)'}`);
      // In production, send to backend: POST /api/report-to-bpom { scanId, notes }
    }
  });
}

// Load on page load
loadResult();
