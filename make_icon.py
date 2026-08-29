from PIL import Image

img = Image.open('topkapi_logo.jpg').convert('L')
width, height = img.size

out = Image.new('RGB', (512, 512), (130, 10, 40))
out_pixels = out.load()
img_pixels = img.load()

offset_x = (512 - width) // 2
offset_y = (512 - height) // 2

maroon = (130, 10, 40)
white = (255, 255, 255)

for y in range(height):
    for x in range(width):
        val = img_pixels[x, y]
        # Invert the grayscale value. Dark (logo) becomes high 'f', Light (bg) becomes low 'f'
        # To avoid gray background noise, we can clamp 'val'
        if val > 200:
            val = 255
        f = (255 - val) / 255.0
        r = int(maroon[0] * (1 - f) + white[0] * f)
        g = int(maroon[1] * (1 - f) + white[1] * f)
        b = int(maroon[2] * (1 - f) + white[2] * f)
        out_pixels[x + offset_x, y + offset_y] = (r, g, b)

out.save('pwa-icon.png')
print("Icon created.")
