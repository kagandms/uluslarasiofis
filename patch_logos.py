import sys

with open('app.js', 'r') as f:
    content = f.read()

# For PDF template
old_goc_pdf = """<img src="goc_logo.jpg" style="height: 100%; width: auto; mix-blend-mode: multiply;" crossorigin="anonymous">"""
new_goc_pdf = """<img src="goc_logo.png" style="height: 100%; width: auto;" crossorigin="anonymous">"""
content = content.replace(old_goc_pdf, new_goc_pdf)

# For Print template
old_goc_print = """<img src="goc_logo.jpg" style="height: 100%; width: auto; mix-blend-mode: multiply;">"""
new_goc_print = """<img src="goc_logo.png" style="height: 100%; width: auto;">"""
content = content.replace(old_goc_print, new_goc_print)

with open('app.js', 'w') as f:
    f.write(content)
