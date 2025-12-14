import torch
import torch.nn as nn
import timm

def get_feature_extractor(model_name='vit_base_patch16_224', pretrained=True):
    """
    Loads a pre-trained Vision Transformer (ViT) and modifies it to be a
    feature extractor.

    Args:
        model_name (str): The name of the ViT model to load from timm.
        pretrained (bool): Whether to load pre-trained weights.

    Returns:
        torch.nn.Module: The modified ViT model that outputs feature embeddings.
    """
    # Load a pre-trained Vision Transformer model from the timm library
    model = timm.create_model(model_name, pretrained=pretrained)
    
    # The feature embedding is the output of the final transformer block,
    # before it goes into the classification head. In many timm models, this
    # can be achieved by setting the `head` attribute to an identity function.
    model.head = nn.Identity()
    
    # Set the model to evaluation mode. This is important because we are not
    # training the ViT itself, only using it for feature extraction. This will
    # disable layers like Dropout.
    model.eval()
    
    print(f"Loaded '{model_name}' model. It has been modified to be a feature extractor.")
    print("The model is set to evaluation mode (model.eval()).")
    
    return model

if __name__ == '__main__':
    # Example of how to use the feature extractor
    
    # Get the model
    feature_extractor = get_feature_extractor()
    
    # Check if a GPU is available and move the model to the GPU
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    feature_extractor.to(device)
    
    print(f"\nModel moved to device: {device}")

    # Create a dummy input tensor (e.g., a batch of 1 image, 3 channels, 224x224 pixels)
    # The values should be normalized, similar to how the training data is.
    dummy_input = torch.randn(1, 3, 224, 224).to(device)
    
    # Perform a forward pass to get the feature embedding
    with torch.no_grad(): # No need to calculate gradients for feature extraction
        embedding = feature_extractor(dummy_input)
        
    print(f"\nExample forward pass:")
    print(f"Input shape:  {dummy_input.shape}")
    print(f"Output embedding shape: {embedding.shape}")
    
    # The output shape will depend on the ViT architecture. For vit_base_patch16_224,
    # it is typically (batch_size, 768). This 768-dimensional vector is the
    # feature embedding for the input image.
