from PIL import Image
import collections

img = Image.open('topkapi_logo.jpg').convert('RGB')
pixels = list(img.getdata())
# Round colors to nearest 10 to group jpeg artifacts
rounded = [(r//10*10, g//10*10, b//10*10) for r,g,b in pixels]
counter = collections.Counter(rounded)
print(counter.most_common(10))
