from PIL import Image
img = Image.open('topkapi_logo.jpg')
colors = img.getcolors(maxcolors=256)
if colors:
    colors.sort(reverse=True)
    print("Top colors:", colors[:5])
else:
    print("Too many colors")
