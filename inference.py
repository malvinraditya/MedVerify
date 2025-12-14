import torch
import joblib
import numpy as np
from PIL import Image
import argparse

from dataset import inference_transform
from model import get_feature_extractor

# --- Configuration ---
MODEL_NAME = 'vit_base_patch16_224'
SVM_MODEL_PATH = 'one_class_svm.joblib'

def run_inference(image_path):
    """
    Runs inference on a single image to determine if it is REAL or FAKE.

    Args:
        image_path (str): Path to the input image.
    """
    # --- Step 1: Set up device and load models ---
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")

    # Load the feature extractor
    print("Loading feature extractor...")
    feature_extractor = get_feature_extractor(model_name=MODEL_NAME)
    feature_extractor.to(device)
    feature_extractor.eval()

    # Load the trained One-Class SVM model
    print(f"Loading trained One-Class SVM model from '{SVM_MODEL_PATH}'...")
    try:
        svm_model = joblib.load(SVM_MODEL_PATH)
    except FileNotFoundError:
        print(f"Error: Trained SVM model not found at '{SVM_MODEL_PATH}'.")
        print("Please run 'python train.py' first to train and save the model.")
        return

    # --- Step 2: Load and preprocess the input image ---
    print(f"Loading and preprocessing image: '{image_path}'...")
    try:
        image = Image.open(image_path).convert('RGB')
    except FileNotFoundError:
        print(f"Error: Image file not found at '{image_path}'.")
        return
        
    # Apply the same transformations used during inference
    image_tensor = inference_transform(image).unsqueeze(0) # Add a batch dimension
    image_tensor = image_tensor.to(device)

    # --- Step 3: Extract features ---
    print("Extracting features from the image...")
    with torch.no_grad():
        embedding = feature_extractor(image_tensor)
        embedding_np = embedding.cpu().numpy()

    # --- Step 4: Make a prediction using the One-Class SVM ---
    print("Making prediction...")
    
    # The `predict` method returns +1 for inliers (REAL) and -1 for outliers (FAKE)
    prediction = svm_model.predict(embedding_np)
    
    # The `decision_function` method provides the signed distance to the separating
    # hyperplane. A positive score means it's an inlier. A negative score means
    # it's an outlier. The more negative, the more anomalous.
    confidence_score = svm_model.decision_function(embedding_np)

    # --- Step 5: Display the result ---
    result = "REAL" if prediction[0] == 1 else "FAKE"
    
    print("\n--- Inference Result ---")
    print(f"Prediction: {result}")
    print(f"Confidence Score: {confidence_score[0]:.4f}")
    print("------------------------")
    if result == "REAL":
        print("This package appears to be authentic.")
    else:
        print("This package is flagged as a potential FAKE (anomaly detected).")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Classify a medicine package as REAL or FAKE.")
    parser.add_argument('--image', type=str, required=True, help='Path to the image file to classify.')
    
    args = parser.parse_args()
    
    run_inference(args.image)
