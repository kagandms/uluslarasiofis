import sys
from PIL import Image

img = Image.open(sys.argv[1]).convert('RGB')
pixels = img.load()
width, height = img.size

# We look for a large white/light-gray region.
# Let's just scan and find the first row and column that has a long continuous sequence of white pixels.

best_box = (0,0,0,0)
max_area = 0

for y in range(height):
    for x in range(width):
        r,g,b = pixels[x,y]
        if r > 230 and g > 230 and b > 230:
            # Found a white pixel, how far down and right does it go?
            # To optimize, let's just find the first one in the top-left, and then expand.
            right = x
            while right < width and pixels[right, y][0] > 230:
                right += 1
            bottom = y
            while bottom < height and pixels[x, bottom][0] > 230:
                bottom += 1
                
            area = (right - x) * (bottom - y)
            if area > max_area:
                max_area = area
                best_box = (x, y, right, bottom)
            
            # skip ahead
            break

print(f"White box bounding box: {best_box}")
cropped = img.crop(best_box)
cropped.save('goc_logo.jpg', quality=95)

