import sys
from PIL import Image

img = Image.open('goc_logo.jpg').convert('RGBA')
pixels = img.load()
width, height = img.size

for y in range(height):
    for x in range(width):
        r, g, b, a = pixels[x, y]
        # If the pixel is very light (e.g., > 200), make it pure white to remove the gray box
        if r > 180 and g > 180 and b > 180:
            pixels[x, y] = (255, 255, 255, 255)

img.convert('RGB').save('goc_logo.jpg', quality=100)
