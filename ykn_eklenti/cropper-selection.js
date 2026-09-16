function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

export function moveSelection(box, pointerStart, pointerCurrent, bounds) {
    const x = clamp(box.x + pointerCurrent.x - pointerStart.x, 0, Math.max(0, bounds.width - box.width));
    const y = clamp(box.y + pointerCurrent.y - pointerStart.y, 0, Math.max(0, bounds.height - box.height));
    return { ...box, x, y };
}

export function isPointInSelection(point, box) {
    return Boolean(box)
        && point.x >= box.x && point.x <= box.x + box.width
        && point.y >= box.y && point.y <= box.y + box.height;
}

export function resizeSelection(box, handle, pointerStart, pointerCurrent, bounds, minimumSize = 20) {
    const dx = pointerCurrent.x - pointerStart.x;
    const dy = pointerCurrent.y - pointerStart.y;
    const right = box.x + box.width;
    const bottom = box.y + box.height;
    let left = box.x;
    let top = box.y;
    let nextRight = right;
    let nextBottom = bottom;

    if (handle.includes('w')) left = clamp(box.x + dx, 0, right - minimumSize);
    if (handle.includes('e')) nextRight = clamp(right + dx, left + minimumSize, bounds.width);
    if (handle.includes('n')) top = clamp(box.y + dy, 0, bottom - minimumSize);
    if (handle.includes('s')) nextBottom = clamp(bottom + dy, top + minimumSize, bounds.height);

    return { x: left, y: top, width: nextRight - left, height: nextBottom - top };
}

export function toDisplayBox(box, canvasSize, displaySize) {
    return {
        x: box.x * displaySize.width / canvasSize.width,
        y: box.y * displaySize.height / canvasSize.height,
        width: box.width * displaySize.width / canvasSize.width,
        height: box.height * displaySize.height / canvasSize.height
    };
}
