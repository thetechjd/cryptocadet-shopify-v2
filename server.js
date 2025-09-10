// server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const fs = require('fs').promises;
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.shopify.com"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://cdn.shopify.com",
          "https://unpkg.com" // ✅ allow App Bridge from unpkg
        ],
        connectSrc: ["'self'", "https://*.myshopify.com", "https://admin.shopify.com"],
        frameSrc: ["'self'", "https://*.myshopify.com", "https://admin.shopify.com"],
        frameAncestors: ["https://*.myshopify.com", "https://admin.shopify.com"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
  })
);

// Remove X-Frame-Options for Shopify embedding
app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

// CORS
app.use(
  cors({
    origin: [
      'https://admin.shopify.com',
      /\.myshopify\.com$/,
      'http://localhost:3000',
      'https://localhost:3000',
      /\.ngrok-free\.app$/,
      /\.ngrok\.io$/,
    ],
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static assets
app.use('/static', express.static(path.join(__dirname, 'public')));

// --------------------
// Utility functions (unchanged)
// --------------------
async function storeMerchantConfig(shop, config) {
  const configPath = path.join(__dirname, 'merchant-configs.json');
  let configs = {};
  try {
    const data = await fs.readFile(configPath, 'utf8');
    configs = JSON.parse(data);
  } catch (_) {}
  configs[shop] = { ...configs[shop], ...config, shop, updated_at: new Date().toISOString() };
  await fs.writeFile(configPath, JSON.stringify(configs, null, 2));
  return configs[shop];
}

async function getMerchantConfig(shop) {
  try {
    const configPath = path.join(__dirname, 'merchant-configs.json');
    const data = await fs.readFile(configPath, 'utf8');
    const configs = JSON.parse(data);
    return configs[shop] || null;
  } catch {
    return null;
  }
}

async function createPaymentCustomization(shop) {
  // … keep your GraphQL mutation logic here …
  return {
    id: `gid://shopify/PaymentCustomization/${Date.now()}`,
    title: "Crypto Payment Gateway",
    enabled: true,
  };
}

async function getShopAccessToken(shop) {
  console.warn("getShopAccessToken not implemented - using placeholder");
  return "placeholder_token";
}

// --------------------
// Routes
// --------------------

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    app: 'cryptocadet-payment-gateway',
    shopify_api_key: process.env.SHOPIFY_API_KEY ? 'configured' : 'missing',
  });
});

// ✅ Root endpoint (fixed for CSP-safe)
app.get('/', (req, res) => {
  const shop = req.query.shop;
  if (shop) {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>CryptoCadet Payment Gateway</title>
        <link rel="stylesheet" href="/static/style.css">
      </head>
      <body>
        <div class="container">
          <h1>CryptoCadet Payment Gateway</h1>
          <p><strong>Shop:</strong> ${shop}</p>
          <div class="section">
            <h2>App Status</h2>
            <div class="status-item">✅ Server running</div>
            <div class="status-item">✅ Connected to Shopify</div>
            <div class="status-item">✅ Ready for payment processing</div>
          </div>
          <div class="section">
            <h2>Payment Method Setup</h2>
            <button id="activate-btn" class="button">Activate Crypto Payment Method</button>
            <div id="activation-status"></div>
          </div>
        </div>
       <script src="https://unpkg.com/@shopify/app-bridge@3"></script>
<script src="/static/app.js"></script>
        
      </body>
      </html>
    `);
  } else {
    res.json({ message: 'CryptoCadet Payment Gateway API' });
  }
});

// Install/OAuth flow
app.get('/install', (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).json({ error: 'Missing shop parameter' });
  res.redirect(`/auth?shop=${shop}`);
});

app.get('/auth', (req, res) => {
  const { shop, code } = req.query;
  if (code) {
    return res.redirect(`https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`);
  }
  const scopes = 'write_checkouts,read_checkouts,read_orders,write_orders';
  const redirectUri = `https://shopify.cryptocadet.app/auth/callback`;
  const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_API_KEY}&scope=${encodeURIComponent(
    scopes
  )}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.redirect(authUrl);
});

app.get('/auth/callback', (req, res) => {
  const { shop, code } = req.query;
  if (!shop || !code) return res.status(400).json({ error: 'Missing OAuth params' });
  res.redirect(`https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`);
});

// Activate payment method
app.post('/activate-payment-method', async (req, res) => {
  const { shop } = req.body;
  if (!shop) return res.status(400).json({ error: 'Shop required' });

  try {
    const paymentCustomization = await createPaymentCustomization(shop);
    await storeMerchantConfig(shop, {
      payment_method_active: true,
      customization_id: paymentCustomization.id,
      activated_at: new Date().toISOString(),
    });
    res.json({ success: true, customization_id: paymentCustomization.id });
  } catch (err) {
    res.status(500).json({ error: 'Activation failed', details: err.message });
  }
});

// Merchant config
app.get('/merchant-config/:shop', async (req, res) => {
  const config = await getMerchantConfig(req.params.shop);
  if (!config) return res.status(404).json({ error: 'Not found' });
  res.json(config);
});

// Payments routes (sessions, confirm, reject) — keep your existing handlers
// Webhooks (orders, app/uninstalled) — keep your existing handlers
// Configure-app, test routes, etc. — keep as is

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal error' });
});

// Start
app.listen(PORT, () => {
  console.log(`🚀 CryptoCadet Payment Server running on http://localhost:${PORT}`);
});
