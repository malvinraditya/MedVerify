import os
import shutil
from pathlib import Path

# Define source and destination directories
SOURCE_DIR = Path('Dataset')
DEST_DIR = Path('training_data/real')

# Create the destination directory, clearing it if it already exists
if DEST_DIR.parent.exists():
    print(f"Removing existing directory: {DEST_DIR.parent}")
    shutil.rmtree(DEST_DIR.parent)

print(f"Creating new directory: {DEST_DIR}")
DEST_DIR.mkdir(parents=True, exist_ok=True)

print(f"Scanning '{SOURCE_DIR}' for image files...")

image_extensions = ['.jpg', '.jpeg', '.png', '.webp']
copied_files = 0

# Walk through the source directory and copy all image files
for root, _, files in os.walk(SOURCE_DIR):
    for file in files:
        source_path = Path(root) / file
        if source_path.suffix.lower() in image_extensions:
            # Sanitize the filename to ensure it's valid
            sanitized_filename = ''.join(c if c.isalnum() or c in ['_', '.', '-'] else '_' for c in file)
            dest_path = DEST_DIR / sanitized_filename
            
            print(f"Copying '{source_path}' to '{dest_path}'")
            shutil.copy(source_path, dest_path)
            copied_files += 1

print(f"\nDataset preparation complete.")
print(f"Successfully copied {copied_files} images to '{DEST_DIR}'.")
print("You are now ready to start the training process.")


