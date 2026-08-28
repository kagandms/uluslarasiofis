import sys

with open('index.css', 'r') as f:
    content = f.read()

header_css = """
/* Header Buttons */
.btn-header {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    color: var(--text-primary);
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 0.85rem;
    font-family: var(--font-body);
    font-weight: 500;
    cursor: pointer;
    transition: var(--transition);
}
.btn-header:hover {
    background: rgba(139, 0, 0, 0.05);
    border-color: var(--accent);
    color: var(--accent);
}
.btn-header.icon-only {
    padding: 6px;
}
@media (max-width: 768px) {
    .hide-mobile {
        display: none;
    }
    .header-actions {
        margin-top: 10px;
        flex-wrap: wrap;
        justify-content: center;
    }
}
"""

if "btn-header" not in content:
    content += header_css
    with open('index.css', 'w') as f:
        f.write(content)
