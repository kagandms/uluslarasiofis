import sys
from PIL import Image

img = Image.open('topkapi_logo_raw.jpg').convert('RGB')
pixels = img.load()
width, height = img.size

# The logo is on the white background. We want the bounding box of the non-white pixels on the LEFT half.
min_x, min_y = width, height
max_x, max_y = 0, 0

for y in range(height):
    for x in range(width // 3): # Only look at the left third
        r, g, b = pixels[x, y]
        if r < 240 or g < 240 or b < 240: # Not pure white
            if x < min_x: min_x = x
            if x > max_x: max_x = x
            if y < min_y: min_y = y
            if y > max_y: max_y = y

print(f"Topkapi emblem box: {min_x}, {min_y}, {max_x}, {max_y}")

if max_x > min_x and max_y > min_y:
    # pad it by 10 pixels
    min_x = max(0, min_x - 10)
    min_y = max(0, min_y - 10)
    max_x = min(width, max_x + 10)
    max_y = min(height, max_y + 10)
    
    logo_only = img.crop((min_x, min_y, max_x, max_y))
    
    # Let's make it a perfect square
    w = max_x - min_x
    h = max_y - min_y
    size = max(w, h)
    
    square = Image.new('RGB', (size, size), (255, 255, 255))
    offset_x = (size - w) // 2
    offset_y = (size - h) // 2
    square.paste(logo_only, (offset_x, offset_y))
    
    square.save('topkapi_logo.jpg', quality=100)

