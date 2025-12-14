import torch
from torch.utils.data import DataLoader
from sklearn.svm import OneClassSVM
import numpy as np
from tqdm import tqdm
import joblib

from dataset import MedicineDataset
from model import get_feature_extractor

# --- Configuration ---
DATA_DIR = 'training_data/real'
MODEL_NAME = 'vit_base_patch16_224'
BATCH_SIZE = 32  # Adjust based on your GPU memory
SVM_NU = 0.01    # Anomaly fraction: Lowered further to make the boundary more tolerant.
SVM_KERNEL = 'rbf'
SVM_GAMMA = 'auto'
OUTPUT_MODEL_PATH = 'one_class_svm.joblib'

def train_pipeline():
    """
    Executes the full training pipeline: feature extraction and One-Class SVM training.
    """
    # --- Step 1: Set up device, dataset, and model ---
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")

    # Initialize the dataset and dataloader
    # IMPORTANT: Use the inference_transform for training the OCSVM to learn the
    # distribution of clean, non-augmented images.
    print("Loading dataset with clean (non-augmented) transformations...")
    from dataset import inference_transform
    dataset = MedicineDataset(image_dir=DATA_DIR, transform=inference_transform)
    if len(dataset) == 0:
        print(f"Error: No images found in '{DATA_DIR}'.")
        print("Please run 'python prepare_dataset.py' first.")
        return
        
    dataloader = DataLoader(dataset, batch_size=BATCH_SIZE, shuffle=False, num_workers=4)

    # Load the feature extractor model
    print("Loading feature extractor model...")
    feature_extractor = get_feature_extractor(model_name=MODEL_NAME)
    feature_extractor.to(device)
    feature_extractor.eval() # Ensure model is in eval mode

    # --- Step 2: Extract features from all real images ---
    print("\nExtracting features from the clean dataset...")
    all_features = []
    
    with torch.no_grad():
        for images, _ in tqdm(dataloader, desc="Extracting Features"):
            images = images.to(device)
            
            # Get embeddings from the feature extractor
            embeddings = feature_extractor(images)
            
            # Move embeddings to CPU and append to our list
            all_features.append(embeddings.cpu().numpy())
            
    # Concatenate all feature batches into a single numpy array
    all_features = np.concatenate(all_features, axis=0)
    print(f"Successfully extracted {all_features.shape[0]} feature vectors of dimension {all_features.shape[1]}.")

    # --- Step 3: Train the One-Class SVM model ---
    print("\nTraining One-Class SVM model...")
    
    # Initialize the One-Class SVM
    # The `nu` parameter is crucial. We use a small value because we assume the
    # training data is almost entirely "real". This value is an upper bound
    # on the fraction of training samples that can be misclassified.
    svm = OneClassSVM(nu=SVM_NU, kernel=SVM_KERNEL, gamma=SVM_GAMMA)
    
    # Train the SVM on the extracted features
    svm.fit(all_features)
    
    print("One-Class SVM training complete.")

    # --- Step 4: Save the trained SVM model ---
    print(f"Saving trained model to '{OUTPUT_MODEL_PATH}'...")
    joblib.dump(svm, OUTPUT_MODEL_PATH)
    
    print("\nTraining pipeline finished successfully!")
    print(f"The trained anomaly detection model is saved at: {OUTPUT_MODEL_PATH}")

if __name__ == '__main__':
    train_pipeline()
