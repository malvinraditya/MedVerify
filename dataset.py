import os
from PIL import Image
from torch.utils.data import Dataset
from torchvision import transforms

class MedicineDataset(Dataset):
    """
    Custom PyTorch Dataset for loading medicine package images and applying
    heavy data augmentation as specified for one-class learning.
    """
    def __init__(self, image_dir, transform=None):
        """
        Args:
            image_dir (str): Directory with all the real images.
            transform (callable, optional): Optional transform to be applied on a sample.
        """
        self.image_dir = image_dir
        self.image_files = [f for f in os.listdir(image_dir) if os.path.isfile(os.path.join(image_dir, f))]
        
        if transform:
            self.transform = transform
        else:
            # Default transformations with heavy augmentation
            self.transform = transforms.Compose([
                transforms.Resize((224, 224)),
                # Heavy data augmentation
                transforms.RandomHorizontalFlip(),
                transforms.RandomRotation(15),
                transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2, hue=0.1),
                transforms.RandomPerspective(distortion_scale=0.2, p=0.5),
                transforms.RandomGrayscale(p=0.1),
                # transforms.GaussianBlur(kernel_size=(5, 9), sigma=(0.1, 5)), # Can be too aggressive
                # Standard transformations
                transforms.ToTensor(),
                transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
            ])

    def __len__(self):
        return len(self.image_files)

    def __getitem__(self, idx):
        img_path = os.path.join(self.image_dir, self.image_files[idx])
        
        try:
            image = Image.open(img_path).convert('RGB')
        except Exception as e:
            print(f"Warning: Could not load image {img_path}. Skipping. Error: {e}")
            # Return a dummy tensor if image is corrupt
            return self.__getitem__((idx + 1) % len(self))

        if self.transform:
            image = self.transform(image)
            
        return image, self.image_files[idx]

# Pre-defined transform for inference (without augmentation)
inference_transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])
