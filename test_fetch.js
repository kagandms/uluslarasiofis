const options = { headers: { 'Content-Type': 'application/octet-stream' } };
const config = { ...options, signal: 'fake_signal' };

if (config.headers instanceof Headers) {
    config.headers.append('Authorization', 'Bearer token123');
} else {
    config.headers['Authorization'] = 'Bearer token123';
}

console.log('config.headers:', config.headers);
console.log('options.headers:', options.headers);
