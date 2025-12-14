# Medicine Package Anomaly Detection Pipeline

This project implements a complete pipeline to detect "fake" or anomalous medicine packaging using only a dataset of "real" samples. It follows a one-class learning approach, specifically using a pre-trained Vision Transformer (ViT) to generate deep feature embeddings and a One-Class SVM to model the distribution of authentic packaging.

## 1. Model Architecture and Strategy

The core idea is to learn a rich, descriptive representation of what "real" medicine packages look like and then identify any deviations from that learned representation as anomalies (fakes).

1.  **Feature Extractor**: A **Vision Transformer (ViT)**, pre-trained on the large-scale ImageNet dataset (`timm/vit_base_patch16_224`), is used as the feature extractor. We leverage its powerful ability to capture complex textures, patterns, and structural details from the images. The final classification head of the ViT is removed, and we use the output of the final transformer block as the feature embedding for each image.

2.  **Anomaly Detection**: A **One-Class Support Vector Machine (One-Class SVM)** is trained on the feature embeddings extracted from the real image dataset. The OCSVM learns a boundary (a hypersphere) in the high-dimensional feature space that encapsulates the majority of the "real" data points.

3.  **Inference Logic**: During inference, a new image is passed through the same ViT feature extractor. The resulting embedding is then evaluated by the trained One-Class SVM.
    *   If the embedding falls **inside** the learned boundary, the SVM predicts it as an inlier, which we classify as **"REAL"**.
    *   If the embedding falls **outside** the boundary, it is considered an outlier or anomaly, and we classify it as **"FAKE"**.

This approach is highly effective because it doesn't require any fake samples for training, making it ideal for real-world scenarios where fake data is scarce or non-existent.

## 2. Dataset Structure

The pipeline expects a simple folder structure for training. All real images, regardless of the medicine type or side, should be placed in a single directory.

```
training_data/
└── real/
    ├── Antangin+Jahe Merah JRG_back.jpg
    ├── Antangin+Jahe Merah JRG_front.jpg
    ├── Antimo Dimenhydrinate_back.jpg
    └── ... (all other real images)
```

A setup script (`prepare_dataset.py`) is provided to automatically create this structure from your original `Dataset` folder.

## 3. How to Use the Pipeline

### Step 1: Prepare the Dataset

First, run the provided script to organize your images into the required structure for training.

```bash
python prepare_dataset.py
```

This will create a `training_data` directory in your project folder.

### Step 2: Train the Model

Next, run the training script. This script will:
1.  Load all real images from `training_data/real`.
2.  Apply heavy data augmentation as specified.
3.  Extract feature embeddings using the pre-trained ViT.
4.  Train a One-Class SVM on these embeddings.
5.  Save the trained SVM model to `one_class_svm.joblib`.

```bash
python train.py
```

### Step 3: Run Inference

Once the model is trained, you can use the inference script to classify new images.

```bash
python inference.py --image /path/to/your/new_image.jpg
```

The script will output:
*   **Prediction**: "REAL" or "FAKE".
*   **Confidence Score**: A score indicating how far the image's embedding is from the learned decision boundary of real samples. A more negative score indicates a higher likelihood of being an anomaly (FAKE).

## 4. Extending the Model

To improve the model with more real samples in the future, simply:
1.  Add the new real images to your original `Dataset` folder.
2.  Delete the existing `training_data` directory.
3.  Re-run the `prepare_dataset.py` script to include the new images.
4.  Re-run the `train.py` script to retrain the One-Class SVM on the updated and expanded set of feature embeddings.

This process ensures the model's understanding of "real" packaging becomes more robust and comprehensive over time.

## 5. MedVerify Web Application

This project includes a web application, **MedVerify**, which provides a user-friendly interface for the medicine verification process.

### Backend (server.js)

The backend is a Node.js server built with Express.js. Its main responsibilities are:
*   Serving the static frontend files (HTML, CSS, JavaScript).
*   Handling file uploads of medicine images.
*   Orchestrating the verification process by calling the Python inference script.
*   Providing API endpoints for the frontend to interact with.

**Key API Endpoints:**
*   `/api/scan/start`: Initiates a new scan job.
*   `/api/scan/:scanId/photo`: Uploads a single photo for a given scan job.
*   `/api/scan/:scanId/finish`: Finalizes the scan job and returns the authenticity result.
*   `/api/dataset/upload`: Allows users to contribute to the dataset by uploading new medicine images.

### Frontend

The frontend is built with HTML, CSS, and vanilla JavaScript. It allows users to:
*   Start a new medicine scan.
*   Upload multiple images of a medicine package (e.g., front, back).
*   View the verification results, including an authenticity score and a classification ("asli", "sedang", "mencurigakan", "palsu").

### How to Run the Web Application

1.  **Install Dependencies:**
    ```bash
    npm install
    ```

2.  **Start the Server:**
    ```bash
    node server.js
    ```

3.  **Access the Application:**
    Open your web browser and navigate to `http://localhost:3000`.