import sys

with open('index.css', 'r') as f:
    content = f.read()

dark_vars = """
body.dark-mode {
    --bg-color: #121212;
    --card-bg: #1e1e24;
    --card-border: #333333;
    --text-primary: #f4f6f8;
    --text-secondary: #a0aec0;
    --accent: #ff4d4d;
    --accent-hover: #ff1a1a;
    --accent-secondary: #ffffff;
    --accent-secondary-hover: #cccccc;
}

body.dark-mode .glass-input {
    background: #2a2a35;
    color: #f4f6f8;
}

body.dark-mode .mini-dropzone {
    background: #1a1a1f;
}

body.dark-mode .toast {
    background: #2a2a35;
}

body.dark-mode .modal-card {
    background: #1e1e24;
}

body.dark-mode select.glass-input {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23a0aec0' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
}

body.dark-mode .field-filled {
    background: rgba(40, 167, 69, 0.1);
}

"""

if "body.dark-mode" not in content:
    content = content.replace("--transition: all 0.3s ease;\n}", "--transition: all 0.3s ease;\n}\n" + dark_vars)
    with open('index.css', 'w') as f:
        f.write(content)
