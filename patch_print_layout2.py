import sys

with open('app.js', 'r') as f:
    content = f.read()

# Remove Tarih block
old_tarih_print = """                    <p style="text-align: right; font-size: 12px; margin-bottom: 2px;">___ / ___/ 202_<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(Tarih)</p>"""
new_tarih_print = ""
content = content.replace(old_tarih_print, new_tarih_print)

# Shrink BELGELER
old_belgeler_print = """                    <ul style="list-style: none; padding: 0; margin: 0; font-size: 12px; padding-left: 15px;">"""
new_belgeler_print = """                    <ul style="list-style: none; padding: 0; margin: 0; font-size: 11px; padding-left: 15px; line-height: 1.1;">"""
content = content.replace(old_belgeler_print, new_belgeler_print)

# Let's also adjust the spacing above TEBLİĞ EDEN to ensure it fits well
old_footer_print = """                    <div style="margin-top: auto; display: flex; justify-content: space-around; font-weight: bold; font-size: 12px; padding-bottom: 20mm; padding-top: 6px; page-break-before: avoid; break-before: avoid;">"""
new_footer_print = """                    <div style="margin-top: auto; display: flex; justify-content: space-around; font-weight: bold; font-size: 13px; padding-bottom: 15mm; padding-top: 15px; page-break-before: avoid; break-before: avoid;">"""
content = content.replace(old_footer_print, new_footer_print)

with open('app.js', 'w') as f:
    f.write(content)
