import sys

with open('app.js', 'r') as f:
    content = f.read()

# Fix CSS for the table
old_css_print = """                    .print-table { width: 100%; border-collapse: collapse; margin-bottom: 3px; }
                    .print-table th, .print-table td { border: 1px solid #000; padding: 4px; text-align: left; vertical-align: middle; font-size: 12px; }"""
new_css_print = """                    .print-table { width: 100%; border-collapse: collapse; margin-bottom: 5px; }
                    .print-table th, .print-table td { border: 1px solid #000; padding: 9px 10px; text-align: left; vertical-align: middle; font-size: 14px; }"""
content = content.replace(old_css_print, new_css_print)

# Fix logos in Print template
old_logos_print = """                        <div style="width: 55px; height: 55px; overflow: hidden; display: flex; align-items: center; border-radius: 5px;">
                            <img src="https://www.topkapi.edu.tr/resources/files/logo_tr.jpg" style="height: 55px; width: auto; max-width: none;">
                        </div>
                        <div style="flex: 1; border: 1px solid black; margin: 0 15px; padding: 6px 0; text-align: center; font-size: 15px; font-weight: bold;">
                            İSTANBUL TOPKAPI ÜNİVERSİTESİ
                        </div>
                        <div style="width: 55px; height: 55px; display: flex; align-items: center; justify-content: flex-end;">
                            <img src="goc_logo.jpg" style="height: 100%; width: auto; mix-blend-mode: multiply;">
                        </div>"""

new_logos_print = """                        <div style="width: 60px; height: 60px; display: flex; align-items: center; justify-content: flex-start;">
                            <img src="topkapi_logo.jpg" style="height: 100%; width: auto; mix-blend-mode: multiply;">
                        </div>
                        <div style="flex: 1; border: 1px solid black; margin: 0 15px; padding: 8px 0; text-align: center; font-size: 16px; font-weight: bold;">
                            İSTANBUL TOPKAPI ÜNİVERSİTESİ
                        </div>
                        <div style="width: 60px; height: 60px; display: flex; align-items: center; justify-content: flex-end;">
                            <img src="goc_logo.jpg" style="height: 100%; width: auto; mix-blend-mode: multiply;">
                        </div>"""

content = content.replace(old_logos_print, new_logos_print)

with open('app.js', 'w') as f:
    f.write(content)
