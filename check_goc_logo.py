import sys
from PIL import Image

img = Image.open('/Users/kagansmtdms/.gemini/antigravity/brain/78b38877-cd56-436e-b719-e88e0a4f6e06/.user_uploaded/media_1787933017509.png').convert('RGB')
cropped = img.crop((163, 112, 614, 564))

# Let's check the center color
print(cropped.getpixel((225, 225)))
