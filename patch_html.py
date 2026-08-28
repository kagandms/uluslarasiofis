import sys

with open('index.html', 'r') as f:
    content = f.read()

old_html = """            <div class="modal-actions" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; margin-top: 15px;">
                <button type="button" id="btn-crop-cancel" class="btn btn-outline" style="grid-column: span 2; width: 100%; padding: 10px 5px; font-size: 0.9rem;">İptal</button>"""

new_html = """            <div class="modal-actions" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; margin-top: 15px;">
                <button type="button" id="btn-crop-cancel" class="btn btn-outline" style="width: 100%; padding: 10px 5px; font-size: 0.9rem;">İptal</button>
                <button type="button" id="btn-crop-skip" class="btn btn-secondary" style="width: 100%; padding: 10px 5px; font-size: 0.9rem;">Kırpmadan İşle</button>"""

content = content.replace(old_html, new_html)

with open('index.html', 'w') as f:
    f.write(content)
