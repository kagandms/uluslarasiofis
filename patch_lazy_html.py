import sys

with open('index.html', 'r') as f:
    content = f.read()

old_libs = """    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>"""
content = content.replace(old_libs, "")

with open('index.html', 'w') as f:
    f.write(content)
