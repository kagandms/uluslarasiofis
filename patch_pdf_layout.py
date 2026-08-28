import sys

with open('app.js', 'r') as f:
    content = f.read()

# Fix CSS for the table
old_css = """                    .pt { width: 100%; border-collapse: collapse; margin-bottom: 3px; }
                    .pt th, .pt td { border: 1px solid #000; padding: 7px 8px; text-align: left; vertical-align: middle; font-size: 13px; font-family: 'Times New Roman', serif; }"""
new_css = """                    .pt { width: 100%; border-collapse: collapse; margin-bottom: 5px; }
                    .pt th, .pt td { border: 1px solid #000; padding: 9px 10px; text-align: left; vertical-align: middle; font-size: 14px; font-family: 'Times New Roman', serif; }"""
content = content.replace(old_css, new_css)

# Fix logos in PDF template
old_logos = """                        <div style="width: 55px; height: 55px; overflow: hidden; display: flex; align-items: center; border-radius: 5px;">
                            <img src="https://www.topkapi.edu.tr/resources/files/logo_tr.jpg" style="height: 55px; width: auto; max-width: none;" crossorigin="anonymous">
                        </div>
                        <div style="flex: 1; border: 1px solid black; margin: 0 15px; padding: 6px 0; text-align: center; font-size: 15px; font-weight: bold;">
                            İSTANBUL TOPKAPI ÜNİVERSİTESİ
                        </div>
                        <div style="width: 55px; height: 55px; display: flex; align-items: center; justify-content: flex-end;">
                            <img src="goc_logo.jpg" style="height: 100%; width: auto; mix-blend-mode: multiply;" crossorigin="anonymous">
                        </div>"""

new_logos = """                        <div style="width: 60px; height: 60px; display: flex; align-items: center; justify-content: flex-start;">
                            <img src="topkapi_logo.jpg" style="height: 100%; width: auto; mix-blend-mode: multiply;" crossorigin="anonymous">
                        </div>
                        <div style="flex: 1; border: 1px solid black; margin: 0 15px; padding: 8px 0; text-align: center; font-size: 16px; font-weight: bold;">
                            İSTANBUL TOPKAPI ÜNİVERSİTESİ
                        </div>
                        <div style="width: 60px; height: 60px; display: flex; align-items: center; justify-content: flex-end;">
                            <img src="goc_logo.jpg" style="height: 100%; width: auto; mix-blend-mode: multiply;" crossorigin="anonymous">
                        </div>"""

content = content.replace(old_logos, new_logos)

# Remove Tarih block
old_tarih = """                    <p style="text-align:right;font-size:11.5px;margin-bottom:4px;">___ / ___ / 202_<br><u>(Tarih)</u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</p>"""
new_tarih = ""
content = content.replace(old_tarih, new_tarih)

# Shrink BELGELER
old_belgeler = """                    <ul style="list-style:none;padding:0 0 0 10px;margin:0;font-size:11.5px;line-height:1.2;">"""
new_belgeler = """                    <ul style="list-style:none;padding:0 0 0 10px;margin:0;font-size:10.5px;line-height:1.2;">"""
content = content.replace(old_belgeler, new_belgeler)

# Let's also adjust the spacing above TEBLİĞ EDEN to ensure it fits well
old_footer = """                    <div style="display:flex;justify-content:space-around;font-weight:bold;font-size:12px;margin-top:35px;">"""
new_footer = """                    <div style="display:flex;justify-content:space-around;font-weight:bold;font-size:13px;margin-top:40px;">"""
content = content.replace(old_footer, new_footer)

with open('app.js', 'w') as f:
    f.write(content)
