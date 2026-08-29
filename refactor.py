import re

with open('src/main.js', 'r', encoding='utf-8') as f:
    code = f.read()

# We need to extract extractFromCoordinates and extractPage2FromCoordinates.
# Let's find their string indices.
def extract_function(name, start_keyword="function"):
    pattern = r"^[ \t]*" + start_keyword + r"[ \t]+" + name + r"\(.*?\)[ \t]*{"
    match = re.search(pattern, code, re.MULTILINE)
    if not match:
        return None, None, None
    
    start_idx = match.start()
    
    # Simple brace counting
    brace_count = 0
    in_string = False
    string_char = ''
    in_regex = False
    
    i = match.end() - 1
    
    while i < len(code):
        char = code[i]
        
        if in_string:
            if char == '\\':
                i += 2
                continue
            if char == string_char:
                in_string = False
        elif in_regex:
            if char == '\\':
                i += 2
                continue
            if char == '/':
                in_regex = False
        else:
            if char in ('"', "'", '`'):
                in_string = True
                string_char = char
            elif char == '/':
                # check if it's a comment or regex
                if i + 1 < len(code) and code[i+1] == '/':
                    # skip to newline
                    while i < len(code) and code[i] != '\n':
                        i += 1
                    continue
                elif i + 1 < len(code) and code[i+1] == '*':
                    # skip to */
                    while i + 1 < len(code) and not (code[i] == '*' and code[i+1] == '/'):
                        i += 1
                    i += 2
                    continue
                else:
                    # simplistic regex handling - if previous non-space is = or ( or , 
                    in_regex = True
            elif char == '{':
                brace_count += 1
            elif char == '}':
                brace_count -= 1
                if brace_count == 0:
                    return code[start_idx:i+1], start_idx, i+1
        i += 1
    return None, None, None

p2_func, p2_start, p2_end = extract_function("extractPage2FromCoordinates")
p1_func, p1_start, p1_end = extract_function("extractFromCoordinates")

if p2_func and p1_func:
    # Fix p2_func to not touch DOM
    p2_func_fixed = re.sub(
        r"const adresField.*?;.*?const telField.*?;.*?const mailField.*?;",
        "const extractedPage2 = { adres: '', tel: '', mail: '' };",
        p2_func, flags=re.DOTALL
    )
    p2_func_fixed = re.sub(
        r"adresField\.value = foundAdres;\s*adresField\.classList\.add\('field-filled'\);\s*console\.log.*?;\s*\}",
        "extractedPage2.adres = foundAdres;\n                }\n            }",
        p2_func_fixed, flags=re.DOTALL
    )
    p2_func_fixed = re.sub(
        r"telField\.value = foundTel;\s*telField\.classList\.add\('field-filled'\);\s*console\.log.*?;\s*\}",
        "extractedPage2.tel = foundTel;\n                }\n            }",
        p2_func_fixed, flags=re.DOTALL
    )
    p2_func_fixed = re.sub(
        r"mailField\.value = foundMail;\s*mailField\.classList\.add\('field-filled'\);\s*console\.log.*?;\s*\}",
        "extractedPage2.mail = foundMail;\n                }\n            }",
        p2_func_fixed, flags=re.DOTALL
    )
    p2_func_fixed = re.sub(
        r"\}\s*$",
        "    return extractedPage2;\n}",
        p2_func_fixed
    )
    
    # Ensure exports
    p1_func_fixed = p1_func.replace("function extractFromCoordinates", "export function extractFromCoordinates")
    p2_func_fixed = p2_func_fixed.replace("function extractPage2FromCoordinates", "export function extractPage2FromCoordinates")
    
    with open('src/utils/parser.js', 'w', encoding='utf-8') as f:
        f.write(p1_func_fixed + "\n\n" + p2_func_fixed)
        
    # Remove from main.js
    new_code = code[:p2_start] + "/* extractPage2FromCoordinates removed */" + code[p2_end:p1_start] + "/* extractFromCoordinates removed */" + code[p1_end:]
    
    # Add imports to main.js
    new_code = new_code.replace('import { calculateTebligatDate } from "./utils/dateUtils.js";', 
                                'import { calculateTebligatDate } from "./utils/dateUtils.js";\nimport { extractFromCoordinates, extractPage2FromCoordinates } from "./utils/parser.js";')
    
    # Handle DOM population for page 2
    new_code = new_code.replace("extractPage2FromCoordinates(serverWords);", 
                                """const page2Data = extractPage2FromCoordinates(serverWords);
                        if (page2Data.adres) {
                            const f = document.getElementById('field-adres');
                            if(f) { f.value = page2Data.adres; f.classList.add('field-filled'); }
                        }
                        if (page2Data.tel) {
                            const f = document.getElementById('field-tel');
                            if(f) { f.value = page2Data.tel; f.classList.add('field-filled'); }
                        }
                        if (page2Data.mail) {
                            const f = document.getElementById('field-mail');
                            if(f) { f.value = page2Data.mail; f.classList.add('field-filled'); }
                        }""")
    
    with open('src/main.js', 'w', encoding='utf-8') as f:
        f.write(new_code)
        
    print("Success")
else:
    print("Could not extract")
