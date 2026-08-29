import re

with open('src/utils/parser.js', 'r', encoding='utf-8') as f:
    code = f.read()

# Replace DOM interactions with object mapping
fixed = re.sub(
    r"const adresField.*?;.*?const telField.*?;.*?const mailField.*?;",
    "const extractedPage2 = { adres: '', tel: '', mail: '' };",
    code, flags=re.DOTALL
)
fixed = re.sub(
    r"if \(adresField\) \{.*?adresField\.classList\.remove\('field-filled'\);\s*\}",
    "",
    fixed, flags=re.DOTALL
)
fixed = re.sub(
    r"if \(telField\) \{.*?telField\.classList\.remove\('field-filled'\);\s*\}",
    "",
    fixed, flags=re.DOTALL
)
fixed = re.sub(
    r"adresField\.value = foundAdres;\s*adresField\.classList\.add\('field-filled'\);\s*console\.log.*?;\s*\}",
    "extractedPage2.adres = foundAdres;\n                }\n            }",
    fixed, flags=re.DOTALL
)
fixed = re.sub(
    r"telField\.value = foundTel;\s*telField\.classList\.add\('field-filled'\);\s*console\.log.*?;\s*\}",
    "extractedPage2.tel = foundTel;\n                }\n            }",
    fixed, flags=re.DOTALL
)
fixed = re.sub(
    r"mailField\.value = foundMail;\s*mailField\.classList\.add\('field-filled'\);\s*console\.log.*?;\s*\}",
    "extractedPage2.mail = foundMail;\n                }\n            }",
    fixed, flags=re.DOTALL
)

# Replace the end
fixed = re.sub(
    r"const mailField = document.getElementById\('field-mail'\);\s*if \(mailField\) \{\s*extractedPage2.mail = foundMail;\s*\}\s*\}\s*\}\s*\}",
    "extractedPage2.mail = foundMail;\n            }\n        }\n    }\n    return extractedPage2;\n}",
    fixed, flags=re.DOTALL
)

with open('src/utils/parser.js', 'w', encoding='utf-8') as f:
    f.write(fixed)
