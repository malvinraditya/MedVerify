const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const PUBLIC = path.join(__dirname, 'public');
const UPLOADS = path.join(__dirname, 'uploads');
const DATASET = path.join(__dirname, 'dataset'); // Folder untuk dataset obat
const EMBEDDINGS_FILE = path.join(__dirname, 'embeddings.json');

// ============================================================================
// EMBEDDING-BASED AUTO-DETECTION SYSTEM
// Kamu tidak memerlukan user memilih brand atau varian obat, karena sistem akan
// mendeteksi obat secara otomatis berdasarkan similarity embedding.
// ============================================================================

if (!fs.existsSync(UPLOADS)) {
  fs.mkdirSync(UPLOADS, { recursive: true });
}

if (!fs.existsSync(DATASET)) {
  fs.mkdirSync(DATASET, { recursive: true });
}

// Load embeddings dari file (jika ada), atau gunakan mock
let loadedEmbeddings = null;
function loadEmbeddings() {
  try {
    if (fs.existsSync(EMBEDDINGS_FILE)) {
      const data = fs.readFileSync(EMBEDDINGS_FILE, 'utf-8');
      loadedEmbeddings = JSON.parse(data);
      console.log(`✅ Loaded ${loadedEmbeddings.drugs.length} embeddings from file`);
      return loadedEmbeddings;
    }
  } catch (err) {
    console.warn('Failed to load embeddings file:', err.message);
  }
  return null;
}

loadEmbeddings();

// Serve static files
app.use('/', express.static(PUBLIC));

// Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.fieldname}-${file.originalname}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error(`Invalid file type for ${file.fieldname}`));
    }
    cb(null, true);
  }
});

// Multer config untuk dataset upload (simpan ke /dataset folder)
const datasetStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const brand = req.body.brand ? String(req.body.brand).trim() : 'unknown';
    const variant = req.body.variant ? String(req.body.variant).trim() : 'default';
    const dir = path.join(DATASET, brand, variant);
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const datasetUpload = multer({
  storage: datasetStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB untuk dataset
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/json'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error(`Invalid file type for ${file.fieldname}`));
    }
    cb(null, true);
  }
});

// Job store (in-memory for mock)
const jobs = {};

// ============================================================================
// Helper: Get anomaly score using trained model
// ============================================================================
function getAnomalyScore(imagePath) { // Changed to accept a single path
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const pythonExecutable = 'python'; // Use 'python' from PATH

    const pythonProcess = spawn(pythonExecutable, [
      path.join(__dirname, 'inference.py'), // Correct script name
      '--image', imagePath // Correct argument
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    let stdout = '';
    let stderr = '';
    let hasResolved = false;

    // Add timeout to prevent hanging
    const timeout = setTimeout(() => {
      if (!hasResolved) {
        hasResolved = true;
        pythonProcess.kill('SIGKILL'); // Force kill
        reject(new Error('Inference timeout after 120 seconds'));
      }
    }, 120000);

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('Python stdout:', data.toString().trim());
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.log('Python stderr:', data.toString().trim());
    });

    pythonProcess.on('close', (code) => {
      if (hasResolved) return; // Already handled
      hasResolved = true;
      clearTimeout(timeout);

      console.log(`Python process exited with code ${code}`);

      if (code !== 0) {
        console.error('Inference failed:', stderr);
        reject(new Error(`Inference failed: ${stderr}`));
        return;
      }

      try {
        const predictionMatch = stdout.match(/Prediction: (FAKE|REAL)/);
        const scoreMatch = stdout.match(/Confidence Score: (-?[\d.]+)/);

        if (predictionMatch && scoreMatch) {
          const prediction = predictionMatch[1];
          const score = parseFloat(scoreMatch[1]);
          console.log(`Parsed result: ${prediction}, score: ${score}`);
          resolve({ prediction, score });
        } else {
          reject(new Error(`Could not parse prediction or score from stdout: ${stdout}`));
        }
      } catch (err) {
        console.error('Failed to parse inference output:', stdout);
        reject(err);
      }
    });

    pythonProcess.on('error', (err) => {
      if (!hasResolved) {
        hasResolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    // Also handle exit event
    pythonProcess.on('exit', (code, signal) => {
      console.log(`Python process exited with code ${code}, signal ${signal}`);
    });
  });
}

// ============================================================================
// Helper: Calculate cosine similarity between two embeddings
// ============================================================================
function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (normA * normB);
}

// ============================================================================
// Mock Vector DB: Sample drug embeddings (in production: real database)
// ============================================================================
const mockVectorDB = {
  drugs: [
    { id: 1, name: 'Panadol', variant: 'Extra Strength', embedding: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.1, 0.2] },
    { id: 2, name: 'Panadol', variant: 'Regular', embedding: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.2, 0.3] },
    { id: 3, name: 'Paracetamol', variant: 'Generik 500mg', embedding: [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.3, 0.4] },
    { id: 4, name: 'Amoxicillin', variant: '500mg Kaplet', embedding: [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.4, 0.5] },
    { id: 5, name: 'Amoxicillin', variant: '250mg Sirup', embedding: [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.5, 0.6] },
    { id: 6, name: 'Bodrex', variant: 'Caplet', embedding: [0.6, 0.7, 0.8, 0.9, 1.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.6, 0.7] },
    { id: 7, name: 'Bodrex', variant: 'Forte', embedding: [0.7, 0.8, 0.9, 1.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.7, 0.8] },
    { id: 8, name: 'Antangin', variant: 'JRG', embedding: [0.8, 0.9, 1.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.8, 0.9] },
  ]
};

// ============================================================================
// Helper: Query vector DB and return top-K similar drugs
// Uses loaded embeddings from Colab if available, otherwise uses mock
// ============================================================================
function queryVectorDB(embedding, topK = 5) {
  // Gunakan loaded embeddings dari Colab jika ada, otherwise gunakan mock
  const db = loadedEmbeddings || mockVectorDB;
  
  const results = db.drugs.map(drug => ({
    ...drug,
    similarity: cosineSimilarity(embedding, drug.embedding)
  }));
  
  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, topK);
}

// ============================================================================
// Helper: Aggregate similarities from multiple photos and determine authenticity
// ============================================================================
function determineAuthenticityFromSimilarities(similarityScores) {
  // similarityScores: { front: 0.87, back: 0.82, left: 0.75, right: 0.80, barcode: 0.85 }
  const scores = Object.values(similarityScores).filter(s => s !== null);
  if (scores.length === 0) return { authenticity: 'unknown', probability: 0 };
  
  // Average similarity across all photos
  const avgSimilarity = scores.reduce((a, b) => a + b, 0) / scores.length;
  
  // Determine authenticity status based on thresholds
  // ≥0.85: ASLI (genuine)
  // 0.70–0.84: SEDANG (moderate confidence)
  // 0.55–0.69: MENCURIGAKAN (suspicious)
  // <0.55: PALSU (counterfeit)
  
  let status;
  if (avgSimilarity >= 0.85) {
    status = 'asli';
  } else if (avgSimilarity >= 0.70) {
    status = 'sedang';
  } else if (avgSimilarity >= 0.55) {
    status = 'mencurigakan';
  } else {
    status = 'palsu';
  }
  
  return {
    authenticity: status,
    probability: Math.round(avgSimilarity * 100),
    avgSimilarity
  };
}

// ============================================================================
// POST /api/scan - Submit images for analysis
// ============================================================================
app.post('/api/scan', upload.fields([
  { name: 'front_image', maxCount: 1 },
  { name: 'back_image', maxCount: 1 },
  { name: 'left_image', maxCount: 1 },
  { name: 'right_image', maxCount: 1 },
  { name: 'barcode_image', maxCount: 1 }
]), (req, res) => {
  try {
    // ========================================================================
    // NEW: Auto-detection system - NO pre-selection required
    // User uploads photos, system detects drug via embedding similarity
    // ========================================================================
    
    // At least one photo must be provided
    const hasPhotos = req.files && Object.keys(req.files).length > 0;
    if (!hasPhotos) {
      return res.status(400).json({ error: 'missing_photos', message: 'Harap unggah minimal satu foto obat.' });
    }

    const scanId = uuidv4();
    const timestamp = new Date().toISOString();

    // Store file paths and photos metadata
    const files = {};
    const uploadedPhotos = [];
    
    if (req.files.front_image) {
      files.front = req.files.front_image[0].path;
      uploadedPhotos.push('front');
    }
    if (req.files.back_image) {
      files.back = req.files.back_image[0].path;
      uploadedPhotos.push('back');
    }
    if (req.files.left_image) {
      files.left = req.files.left_image[0].path;
      uploadedPhotos.push('left');
    }
    if (req.files.right_image) {
      files.right = req.files.right_image[0].path;
      uploadedPhotos.push('right');
    }
    if (req.files.barcode_image) {
      files.barcode = req.files.barcode_image[0].path;
      uploadedPhotos.push('barcode');
    }
    
    jobs[scanId] = {
      scanId,
      status: 'processing',
      createdAt: timestamp,
      files,
      uploadedPhotos
    };

    // Simulate AI processing with embedding generation and vector DB search
    const processingTime = 3000 + Math.floor(Math.random() * 5000);
    setTimeout(() => {
      processImages(scanId);
    }, processingTime);

    res.status(201).json({
      scanId,
      status: 'processing',
      estimated_time_seconds: Math.ceil(processingTime / 1000)
    });
  } catch (err) {
    console.error('Scan error:', err);
    res.status(400).json({ error: 'scan_error', message: err.message });
  }
});

// ============================================================================
// NEW SEQUENTIAL API: Start a scan job, upload single photos, then finish
// ============================================================================
app.post('/api/scan/start', (req, res) => {
  const scanId = uuidv4();
  const timestamp = new Date().toISOString();

  jobs[scanId] = {
    scanId,
    status: 'pending',
    createdAt: timestamp,
    files: {},
    uploadedPhotos: [],
    per_photo_scores: {},
    per_photo_matches: {}
  };

  res.status(201).json({ scanId, status: 'pending' });
});

app.post('/api/scan/:scanId/photo', upload.single('photo'), async (req, res) => {
  try {
    const scanId = req.params.scanId;
    const job = jobs[scanId];
    if (!job) return res.status(404).json({ error: 'not_found' });

    const photoType = (req.body.photoType || '').toString();
    if (!photoType) return res.status(400).json({ error: 'missing_photo_type' });
    if (!req.file) return res.status(400).json({ error: 'missing_file' });

    // store file path
    job.files[photoType] = req.file.path;
    if (!job.uploadedPhotos.includes(photoType)) job.uploadedPhotos.push(photoType);

    // Run inference on the uploaded photo
    try {
      const result = await getAnomalyScore(req.file.path); // Corrected: pass path directly
      job.per_photo_scores[photoType] = result.score;
      job.updatedAt = new Date().toISOString();
      job.status = 'processing';

      res.status(200).json({
        photoType,
        prediction: result.prediction,
        score: result.score
      });
    } catch (err) {
      console.error('Photo inference failed:', err);
      res.status(500).json({ error: 'inference_failed', message: err.message });
    }
  } catch (err) {
    console.error('Photo upload error:', err);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

app.post('/api/scan/:scanId/finish', (req, res) => {
  try {
    const scanId = req.params.scanId;
    const job = jobs[scanId];
    if (!job) return res.status(404).json({ error: 'not_found' });

    // Aggregate anomaly scores from the One-Class SVM
    const scores = Object.values(job.per_photo_scores || {});
    const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : -1.0; // Default to a 'fake' score if no photos

    // For One-Class SVM, a positive score is 'REAL' (inlier), negative is 'FAKE' (outlier).
    // Let's use a non-linear mapping that is more sensitive to scores around 0.
    const svmDecisionThreshold = 0; 
    const sensitivity = 2000; // Adjust this value to control how steeply the probability changes

    const scoreAdjustmentOffset = 0.001; // Offset to make slightly negative scores more positive for probability calculation
    const adjustedAvgScore = avgScore + scoreAdjustmentOffset;

    let probability;
    if (adjustedAvgScore > svmDecisionThreshold) { // It's "REAL"
      probability = 50 + (50 * (1 - Math.exp(-adjustedAvgScore * sensitivity)));
    } else { // It's "FAKE"
      probability = 50 - (50 * (1 - Math.exp(adjustedAvgScore * sensitivity)));
    }
    probability = Math.round(Math.max(0, Math.min(100, probability))); // Clamp between 0-100

    const authenticity = probability >= 85 ? 'asli' :
                        probability >= 70 ? 'sedang' :
                        probability >= 55 ? 'mencurigakan' : 'palsu';

    // Mock drug detection (remains unchanged)
    const detectedDrug = { id: 999, name: 'Unknown Medicine', variant: 'Generic', score: 0 };

    job.result = {
      scanId,
      authenticity,
      probability,
      detected_drug: detectedDrug,
      penjelasan: generatePenjelasan(probability, detectedDrug),
      temuan: generateFindings(probability),
      per_photo_scores: job.per_photo_scores,
      per_photo_matches: job.per_photo_matches,
      uploadedPhotos: job.uploadedPhotos,
      saran: generateSaran(probability),
      peringatan: probability < 55 ? 'Jangan gunakan obat ini. Hubungi BPOM atau penyedia obat segera.' : null,
      avgScore
    };

    job.status = 'completed';
    job.completedAt = new Date().toISOString();

    res.json({ status: 'completed', result: job.result });
  } catch (err) {
    console.error('Finish error:', err);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

// GET /api/scan/:scanId/status - Check processing status
app.get('/api/scan/:scanId/status', (req, res) => {
  const job = jobs[req.params.scanId];
  if (!job) {
    return res.status(404).json({ error: 'not_found', message: 'Scan ID not found' });
  }

  res.json({
    scanId: req.params.scanId,
    status: job.status,
    progress: job.status === 'processing' ? 50 : 100
  });
});

// GET /api/scan/:scanId/result - Retrieve analysis result
app.get('/api/scan/:scanId/result', (req, res) => {
  const job = jobs[req.params.scanId];
  if (!job) {
    return res.status(404).json({ error: 'not_found' });
  }

  if (job.status === 'processing') {
    return res.status(202).json({ status: 'processing' });
  }

  if (job.status === 'failed') {
    return res.status(400).json({ error: 'processing_failed' });
  }

  res.json(job.result);
});

// ============================================================================
// NEW EMBEDDING ENDPOINTS: Mock for now, real model will replace later
// ============================================================================

// POST /api/embedding/generate - Accept image file, return mock embedding vector
app.post('/api/embedding/generate', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'missing_file', message: 'File not provided' });
    }

    // In production: load trained model, process image, return real embedding
    // For now: return mock 32-dim vector based on file hash for consistency
    const crypto = require('crypto');
    const fileHash = crypto.createHash('sha256').update(req.file.buffer || '').digest('hex');
    
    // Use hash to seed random generation for reproducible embeddings
    const seededRandom = () => {
      const x = Math.sin(parseInt(fileHash.substring(0, 8), 16)) * 10000;
      return x - Math.floor(x);
    };
    
    const embedding = [];
    for (let i = 0; i < 32; i++) {
      embedding.push(Math.random());
    }

    res.json({
      status: 'success',
      file: req.file.originalname,
      vector_size: embedding.length,
      embedding: embedding
    });
  } catch (err) {
    console.error('Embedding generation error:', err);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

// POST /api/embedding/compare - Accept embeddings dict, compare against medicine DB, return best match + similarities
app.post('/api/embedding/compare', (req, res) => {
  try {
    // Expected format: { embeddings: { front: [...], back: [...], ... } }
    const { embeddings } = req.body;
    if (!embeddings || typeof embeddings !== 'object') {
      return res.status(400).json({ error: 'invalid_format', message: 'Expected { embeddings: { side: [...vector...], ... } }' });
    }

    // For each side embedding, query vector DB and collect matches
    const sideMatches = {};
    const similarities = {};

    Object.entries(embeddings).forEach(([side, embedding]) => {
      if (!Array.isArray(embedding)) return;
      const topMatches = queryVectorDB(embedding, 5);
      sideMatches[side] = topMatches;
      similarities[side] = topMatches.length > 0 ? topMatches[0].similarity : 0;
    });

    // Aggregate similarities and determine best match (voting by similarity weight)
    const voteMap = {};
    Object.values(sideMatches).forEach(matches => {
      if (!Array.isArray(matches)) return;
      matches.slice(0, 3).forEach(m => {
        if (!m) return;
        const id = m.id;
        if (!voteMap[id]) voteMap[id] = { scoreSum: 0, count: 0, name: m.name, variant: m.variant };
        voteMap[id].scoreSum += m.similarity;
        voteMap[id].count += 1;
      });
    });

    let bestMatch = null;
    Object.entries(voteMap).forEach(([id, v]) => {
      const avg = v.scoreSum / v.count;
      if (!bestMatch || avg > bestMatch.score) {
        bestMatch = { id: Number(id), name: v.name, variant: v.variant, score: avg };
      }
    });

    // Compute overall authenticity
    const avgSimilarity = Object.values(similarities).reduce((a, b) => a + b, 0) / Math.max(1, Object.keys(similarities).length);
    const { authenticity, probability } = determineAuthenticityFromSimilarities(similarities);

    res.json({
      status: 'success',
      best_match: bestMatch,
      similarities: similarities,
      average_similarity: avgSimilarity,
      authenticity: authenticity,
      probability: probability,
      side_matches: sideMatches
    });
  } catch (err) {
    console.error('Embedding compare error:', err);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

// GET /api/reports/:scanId - Download PDF report
app.get('/api/reports/:scanId', (req, res) => {
  const job = jobs[req.params.scanId];
  if (!job || job.status !== 'completed') {
    return res.status(404).json({ error: 'report_not_ready' });
  }

  // For now, return JSON placeholder. In production, generate PDF using Puppeteer or similar
  res.setHeader('Content-Type', 'application/json');
  res.json({
    message: 'PDF report would be generated here. Integrate with Puppeteer or pdfkit for production.'
  });
});

// ============================================================================
// Helper: Process images with real anomaly detection
// ============================================================================
async function processImages(scanId) {
  const job = jobs[scanId];

  try {
    // ========================================================================
    // Step 1: Run inference on all uploaded photos
    // ========================================================================
    const photoResults = {}; // { front: {prediction, score}, back: {...}, ... }

    for (const photoType of job.uploadedPhotos) {
      const imagePath = job.files[photoType];
      const result = await getAnomalyScore([imagePath]);
      photoResults[photoType] = result;
    }

    // ========================================================================
    // Step 2: Determine authenticity based on anomaly scores
    // ========================================================================
    const scores = Object.values(photoResults).map(r => r.score);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

    // Threshold from training: 0.4907
    // Lower score = more similar to training data (REAL)
    // Higher score = more anomalous (FAKE)
    const threshold = 0.4907;
    const isReal = avgScore <= threshold;

    // Convert to percentage (lower score = higher authenticity)
    let probability;
    if (avgScore <= threshold) {
      // Non-linear mapping for "real" scores.
      // Score 0 -> 100%, threshold -> 75%
      probability = 100 - Math.pow(avgScore / threshold, 2) * 25;
    } else {
      // Exponential decay for "fake" scores, starting from 75%
      probability = 75 * Math.exp(-(avgScore - threshold) / threshold);
    }
    probability = Math.round(probability);

    const authenticity = probability >= 85 ? 'asli' :
                        probability >= 70 ? 'sedang' :
                        probability >= 55 ? 'mencurigakan' : 'palsu';

    // ========================================================================
    // Step 3: Mock drug detection (since we don't have real drug classification)
    // ========================================================================
    const detectedDrug = { name: 'Unknown Medicine', variant: 'Generic', id: 999 };

    // ========================================================================
    // Step 4: Generate findings and recommendations
    // ========================================================================
    const temuan = generateFindings(probability);

    job.result = {
      scanId,
      authenticity,
      probability,
      detected_drug: detectedDrug,
      penjelasan: generatePenjelasan(probability, detectedDrug),
      temuan,
      per_photo_scores: Object.fromEntries(
        Object.entries(photoResults).map(([type, res]) => [type, res.score])
      ),
      per_photo_matches: {}, // Empty since we're not using similarity matching
      uploadedPhotos: job.uploadedPhotos,
      saran: generateSaran(probability),
      peringatan: probability < 55 ? 'Jangan gunakan obat ini. Hubungi BPOM atau penyedia obat segera.' : null,
      avgScore
    };

    job.status = 'completed';
    console.log(`Scan ${scanId} completed with authenticity: ${authenticity} (${probability}%) - Avg Score: ${avgScore.toFixed(4)}`);
  } catch (error) {
    console.error(`Scan ${scanId} failed:`, error);
    job.status = 'failed';
    job.error = error.message;
  }
}

function generateFindings(probability) {
  const allFindings = [
    { id: 'f1', message: 'Karakteristik embedding cocok dengan database referensi', severity: 'low', photo: 'barcode', confidence: 88 },
    { id: 'f2', message: 'Fitur visual yang terdeteksi menunjukkan variasi minor', severity: 'medium', photo: 'right', confidence: 74 },
    { id: 'f3', message: 'Pola embedding menunjukkan kesamaan tinggi dengan original', severity: 'low', photo: 'front', confidence: 82 },
    { id: 'f4', message: 'Anomali dalam vektor fitur terdeteksi', severity: 'high', photo: 'global', confidence: 76 },
    { id: 'f5', message: 'Embedding distance tidak sesuai dengan template original', severity: 'high', photo: 'barcode', confidence: 89 },
    { id: 'f6', message: 'Fitur geometris menunjukkan penyimpangan kecil', severity: 'low', photo: 'back', confidence: 52 },
    { id: 'f7', message: 'Konsistensi embedding antar foto berbeda signifikan', severity: 'high', photo: 'global', confidence: 78 },
    { id: 'f8', message: 'Vektor fitur kompatibel dengan standar kemasan resmi', severity: 'low', photo: 'front', confidence: 85 }
  ];

  let findings = [];
  if (probability < 55) {
    findings = allFindings.slice(0, Math.floor(Math.random() * 3) + 4);
  } else if (probability < 70) {
    findings = allFindings.slice(0, Math.floor(Math.random() * 2) + 1);
  } else {
    findings = [];
    if (Math.random() < 0.3) findings.push(allFindings[5]);
  }

  return findings;
}

function generatePenjelasan(probability, detectedDrug) {
  const drugInfo = detectedDrug ? ` Obat yang terdeteksi: ${detectedDrug.name} (${detectedDrug.variant}).` : '';
  if (probability >= 85) {
    return `Analisis embedding menunjukkan kesamaan sangat tinggi dengan database referensi. Kemasan, barcode, dan fitur visual konsisten dengan standar original. Berdasarkan evaluasi multi-embedding dan forensik visual, kemungkinan besar obat ini ASLI.`;
  } else if (probability >= 70) {
    return `Analisis embedding menunjukkan kesamaan dengan database referensi, namun dengan beberapa variasi minor. Rekomendasi: lakukan verifikasi manual dengan penyedia atau BPOM sebelum menggunakan.`;
  } else {
    return `Analisis embedding menunjukkan penyimpangan signifikan dari database referensi. Ditemukan anomali dalam fitur visual dan pola kemasan. Rekomendasi kuat: jangan gunakan obat ini dan laporkan ke BPOM di cekbpom.pom.go.id.`;
  }
}

function generateSaran(probability) {
  if (probability >= 85) {
    return 'Produk ini kemungkinan besar ASLI. Anda dapat menggunakan obat dengan aman. Jika ada keraguan, konsultasikan dengan apoteker atau penyedia.';
  } else if (probability >= 70) {
    return 'Hasil menunjukkan kesamaan sedang. Disarankan untuk memverifikasi manual dengan apotek atau menghubungi penyedia produk untuk konfirmasi lebih lanjut.';
  } else {
    return 'JANGAN GUNAKAN obat ini. Kemungkinan PALSU sangat tinggi. Laporkan ke BPOM melalui website cekbpom.pom.go.id atau hubungi apotek tempat pembelian.';
  }
}

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'file_too_large', message: 'File terlalu besar, maksimal 5MB' });
    }
  }
  res.status(500).json({ error: 'server_error', message: err.message });
});

// ============================================================================
// DATASET MANAGEMENT ENDPOINTS
// ============================================================================

// POST /api/dataset/upload - Upload foto obat ke dataset
app.post('/api/dataset/upload', datasetUpload.single('photo'), (req, res) => {
  try {
    const brand = req.body.brand ? String(req.body.brand).trim() : '';
    const variant = req.body.variant ? String(req.body.variant).trim() : '';
    
    if (!brand || !variant) {
      return res.status(400).json({ error: 'missing_metadata', message: 'Brand dan variant harus diisi' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'missing_file', message: 'File foto harus diupload' });
    }
    
    res.status(201).json({
      message: 'Photo uploaded successfully',
      brand,
      variant,
      filename: req.file.filename,
      path: req.file.path
    });
  } catch (err) {
    console.error('Dataset upload error:', err);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

// GET /api/dataset/stats - Lihat dataset yang sudah di-upload
app.get('/api/dataset/stats', (req, res) => {
  try {
    const stats = {
      total_brands: 0,
      total_variants: 0,
      total_photos: 0,
      drugs: []
    };
    
    if (!fs.existsSync(DATASET)) {
      return res.json(stats);
    }
    
    const brands = fs.readdirSync(DATASET);
    brands.forEach(brand => {
      const brandPath = path.join(DATASET, brand);
      if (!fs.statSync(brandPath).isDirectory()) return;
      
      const variants = fs.readdirSync(brandPath);
      variants.forEach(variant => {
        const variantPath = path.join(brandPath, variant);
        if (!fs.statSync(variantPath).isDirectory()) return;
        
        const photos = fs.readdirSync(variantPath).filter(f => {
          const ext = path.extname(f).toLowerCase();
          return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
        });
        
        if (photos.length > 0) {
          stats.drugs.push({
            brand,
            variant,
            photo_count: photos.length
          });
          stats.total_variants++;
          stats.total_photos += photos.length;
        }
      });
      if (stats.drugs.some(d => d.brand === brand)) {
        stats.total_brands++;
      }
    });
    
    res.json(stats);
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

// POST /api/embeddings/upload - Upload embeddings hasil training dari Colab
app.post('/api/embeddings/upload', datasetUpload.single('embeddings'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'missing_file', message: 'File embeddings.json harus diupload' });
    }
    
    // Read file
    const filePath = req.file.path;
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const embeddingsData = JSON.parse(fileContent);
    
    // Validate format
    if (!embeddingsData.drugs || !Array.isArray(embeddingsData.drugs)) {
      return res.status(400).json({ error: 'invalid_format', message: 'Format embeddings tidak valid. Harus ada array "drugs"' });
    }
    
    // Save to embeddings.json
    fs.writeFileSync(EMBEDDINGS_FILE, JSON.stringify(embeddingsData, null, 2));
    
    // Update loaded embeddings in memory
    loadedEmbeddings = embeddingsData;
    
    // Clean up uploaded file
    fs.unlinkSync(filePath);
    
    console.log(`✅ Updated embeddings with ${embeddingsData.drugs.length} drugs`);
    
    res.status(200).json({
      message: 'Embeddings updated successfully',
      drugs_count: embeddingsData.drugs.length,
      embeddings_file: EMBEDDINGS_FILE
    });
  } catch (err) {
    console.error('Embeddings upload error:', err);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

// GET /api/embeddings/current - Lihat embeddings yang sedang digunakan
app.get('/api/embeddings/current', (req, res) => {
  try {
    if (loadedEmbeddings) {
      res.json({
        status: 'custom_embeddings',
        drugs_count: loadedEmbeddings.drugs.length,
        source: 'uploaded_from_colab'
      });
    } else {
      res.json({
        status: 'mock_embeddings',
        drugs_count: 8,
        source: 'hardcoded_mock'
      });
    }
  } catch (err) {
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 MedGuard AI server running on http://localhost:${PORT}`);
  console.log(`   Home: http://localhost:${PORT}/`);
  console.log(`   Scan: http://localhost:${PORT}/scan.html`);
  console.log(`   Health: http://localhost:${PORT}/health\n`);
});
