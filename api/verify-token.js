import { verifyToken } from "./_auth.js";

export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const authStatus = verifyToken(req);
    if (!authStatus || authStatus === "MISSING_CONFIG") {
        return res.status(401).json({ valid: false, error: 'Unauthorized' });
    }

    return res.status(200).json({ valid: true });
}
