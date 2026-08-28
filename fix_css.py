import sys

with open('index.css', 'r') as f:
    content = f.read()

old_header = """.app-header {
    background: #ffffff;
    border-bottom: 2px solid var(--accent);"""

new_header = """.app-header {
    background: var(--card-bg);
    border-bottom: 2px solid var(--accent);"""

content = content.replace(old_header, new_header)

with open('index.css', 'w') as f:
    f.write(content)
