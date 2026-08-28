import sys
from PIL import Image

img = Image.open('/Users/kagansmtdms/.gemini/antigravity/brain/78b38877-cd56-436e-b719-e88e0a4f6e06/.user_uploaded/media_1787933017509.png').convert('RGB')
cropped = img.crop((163, 112, 614, 564))

pixels = cropped.load()
width, height = cropped.size

min_x, min_y = width, height
max_x, max_y = 0, 0

# The background is roughly (200, 189, 183). We want to find pixels that are significantly different from this background.
# Or wait, maybe the background of the image in the screenshot was a gray checkerboard? Yandex Images uses a gray/white checkerboard for transparent PNGs!
# YES! (200, 189, 183) and (255, 255, 255) might be the checkerboard!

for y in range(height):
    for x in range(width):
        r, g, b = pixels[x, y]
        # If it's not white and not light gray, it's part of the logo.
        # Let's check for "color" or "darkness".
        if abs(r - g) > 20 or abs(r - b) > 20 or (r < 150 and g < 150 and b < 150):
            if x < min_x: min_x = x
            if x > max_x: max_x = x
            if y < min_y: min_y = y
            if y > max_y: max_y = y

print(f"Tight box: {min_x}, {min_y}, {max_x}, {max_y}")

if max_x > min_x and max_y > min_y:
    logo_only = cropped.crop((min_x, min_y, max_x, max_y))
    # Create a white background image of the same size
    white_bg = Image.new("RGB", logo_only.size, (255, 255, 255))
    
    # We want to replace the checkerboard with white.
    l_pixels = logo_only.load()
    w_pixels = white_bg.load()
    lw, lh = logo_only.size
    for y in range(lh):
        for x in range(lw):
            r, g, b = l_pixels[x, y]
            # Checkerboard is light gray or white.
            # If it's close to gray (e.g. all > 170 and difference between them < 20)
            if r > 170 and g > 170 and b > 170 and abs(r-g) < 20 and abs(r-b) < 20:
                pass # keep it white in white_bg
            else:
                w_pixels[x, y] = (r, g, b)
                
    white_bg.save('goc_logo.jpg', quality=100)
