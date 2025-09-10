const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// --------------------
// Middleware
// --------------------

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
          "https://unpkg.com"
        ],
        connectSrc: [
          "'self'",
          "https://*.myshopify.com",
          "https://admin.shopify.com"
        ],
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
// Storage Functions
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

async function storeShopToken(shop, accessToken) {
  const tokenPath = path.join(__dirname, 'shop-tokens.json');
  let tokens = {};
  try {
    const data = await fs.readFile(tokenPath, 'utf8');
    tokens = JSON.parse(data);
  } catch (_) {}
  tokens[shop] = {
    access_token: accessToken,
    shop: shop,
    created_at: new Date().toISOString()
  };
  await fs.writeFile(tokenPath, JSON.stringify(tokens, null, 2));
  console.log(`Stored access token for shop: ${shop}`);
}

// Also update your getShopAccessToken function to add debugging:

async function getShopAccessToken(shop) {
  try {
    const tokenPath = path.join(__dirname, 'shop-tokens.json');
    console.log('Looking for access token for shop:', shop);
    console.log('Token file path:', tokenPath);
    
    const data = await fs.readFile(tokenPath, 'utf8');
    const tokens = JSON.parse(data);
    
    console.log('Available shops in token file:', Object.keys(tokens));
    console.log('Requested shop exists:', shop in tokens);
    
    const token = tokens[shop]?.access_token || null;
    console.log('Token found:', token ? 'YES' : 'NO');
    
    return token;
  } catch (error) {
    console.log('Error reading token file:', error.message);
    return null;
  }
}


// --------------------
// Shopify API Functions
// --------------------
async function makeShopifyRequest(shop, query, variables = {}) {
  const accessToken = await getShopAccessToken(shop);
  if (!accessToken) {
    throw new Error(`No access token found for shop: ${shop}`);
  }

  const response = await fetch(`https://${shop}/admin/api/2024-07/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables })
  });

  const result = await response.json();
  if (result.errors) {
    throw new Error(`GraphQL errors: ${result.errors.map(e => e.message).join(', ')}`);
  }
  return result.data;
}

// **** UPDATED: This function is not used for this goal, but kept for future reference
// async function createPaymentCustomization(shop) {
//   // ... your GraphQL mutation logic here ...
//   return {
//     id: `gid://shopify/PaymentCustomization/${Date.now()}`,
//     title: "Crypto Payment Gateway",
//     enabled: true,
//   };
// }

// **** NEW: Function to create the script tag
async function createScriptTag(shop) {
  const mutation = `
    mutation scriptTagCreate($input: ScriptTagInput!) {
      scriptTagCreate(input: $input) {
        scriptTag {
          id
          src
          displayScope
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    input: {
      src: "https://shopify.cryptocadet.app/checkout-extension.js",
      displayScope: "ALL"
    }
  };

  try {
    const data = await makeShopifyRequest(shop, mutation, variables);

    if (data.scriptTagCreate.userErrors.length > 0) {
      throw new Error(`Script tag errors: ${data.scriptTagCreate.userErrors.map(e => e.message).join(', ')}`);
    }

    return data.scriptTagCreate.scriptTag;
  } catch (error) {
    console.error('Failed to create script tag:', error);
    throw error;
  }
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

// Root endpoint
app.get('/', (req, res) => {
  const shop = req.query.shop || '';

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>CryptoCadet Payment Gateway</title>
      <link rel="stylesheet" href="/static/style.css">

      <script>
        window.SHOPIFY_API_KEY = "${process.env.SHOPIFY_API_KEY}";
      </script>
    </head>
    <body>
      <div class="container">
        <h1>CryptoCadet Payment Gateway</h1>
        <p><strong>Shop:</strong> ${shop}</p>

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
});

// Install/OAuth flow
app.get('/install', (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).json({ error: 'Missing shop parameter' });
  res.redirect(`/auth?shop=${shop}`);
});

app.get('/auth', (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).json({ error: 'Missing shop parameter' });

  // **** UPDATED: Added script tag scopes
  const scopes = 'write_checkouts,read_checkouts,read_orders,write_orders,read_script_tags,write_script_tags';
  const redirectUri = `https://shopify.cryptocadet.app/auth/callback`;
  const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_API_KEY}&scope=${encodeURIComponent(
    scopes
  )}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  const { shop, code, state } = req.query;
  console.log('OAuth callback received:', { shop, code: code ? 'present' : 'missing', state });
  
  if (!shop || !code) {
    console.error('Missing required OAuth params:', { shop, code });
    return res.status(400).send('Missing shop or code parameter');
  }

  try {
    console.log(`Making token request to: https://${shop}/admin/oauth/access_token`);
    
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code,
      }),
    });

    const tokenData = await tokenResponse.json();
    console.log('Token response status:', tokenResponse.status);
    console.log('Token response data:', tokenData);

    if (!tokenResponse.ok) {
      console.error('Token request failed:', tokenData);
      return res.status(400).send(`OAuth failed: ${JSON.stringify(tokenData)}`);
    }

    if (!tokenData.access_token) {
      console.error('No access token in response:', tokenData);
      return res.status(400).send('No access token received');
    }

    // Store the token
    await storeShopToken(shop, tokenData.access_token);
    
    // Verify storage worked
    const storedToken = await getShopAccessToken(shop);
    console.log('Token storage verification:', storedToken ? 'SUCCESS' : 'FAILED');

    res.redirect(`https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send(`OAuth error: ${error.message}`);
  }
});

// Replace your activate payment method route with this enhanced version:

app.post('/activate-payment-method', async (req, res) => {
  const { shop } = req.body;
  console.log('Activate payment method request:', { shop, body: req.body });
  
  if (!shop) {
    console.error('No shop provided in request body');
    return res.status(400).json({ error: 'Shop required' });
  }

  try {
    // Check if we have an access token
    const accessToken = await getShopAccessToken(shop);
    console.log('Access token check:', accessToken ? 'FOUND' : 'NOT FOUND');
    
    if (!accessToken) {
      console.error(`No access token found for shop: ${shop}`);
      
      // List all stored shops for debugging
      try {
        const tokenPath = path.join(__dirname, 'shop-tokens.json');
        const data = await fs.readFile(tokenPath, 'utf8');
        const tokens = JSON.parse(data);
        console.log('Available shops in storage:', Object.keys(tokens));
      } catch (e) {
        console.log('No token file found or error reading it:', e.message);
      }
      
      return res.status(401).json({ 
        error: 'No access token found', 
        shop: shop,
        message: 'Please reinstall the app by going through the OAuth flow again'
      });
    }

    console.log('Creating script tag for shop:', shop);
    const scriptTag = await createScriptTag(shop);
    console.log('Script tag created successfully:', scriptTag);
    
    await storeMerchantConfig(shop, {
      script_tag_id: scriptTag.id,
      activated_at: new Date().toISOString(),
    });
    
    res.json({ success: true, script_tag_id: scriptTag.id });
  } catch (err) {
    console.error('Activation failed:', err);
    res.status(500).json({ error: 'Activation failed', details: err.message });
  }
});


// Merchant config
app.get('/merchant-config/:shop', async (req, res) => {
  const config = await getMerchantConfig(req.params.shop);
  if (!config) return res.status(404).json({ error: 'Not found' });
  res.json(config);
});

// **** UPDATED: This route serves the actual JavaScript file
app.get('/checkout-extension.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`
    (function () {
      const SCRIPT_ID = "crypto-pay-button-script";

      // Only run this script on the cart page
      if (!window.location.pathname.includes('/cart')) {
        console.log('CryptoCadet: Not on cart page, skipping');
        return;
      }

      if (document.getElementById(SCRIPT_ID)) {
        console.log('CryptoCadet: Script already loaded');
        return;
      }
      
      const scriptElement = document.createElement('script');
      scriptElement.id = SCRIPT_ID;
      document.head.appendChild(scriptElement);

      function findTargetButton() {
        // Find the standard checkout button on the cart page
        const cartTargets = [
          'button[name="checkout"]',
          'input[name="checkout"][type="submit"]',
          '.cart__checkout-button',
          '.cart__checkout',
          'a[href*="/checkout"]',
          '.checkout-button',
          'form[action*="/checkout"] button',
          'form[action*="/checkout"] input[type="submit"]'
        ];
        
        for (const selector of cartTargets) {
          const el = document.querySelector(selector);
          if (el) {
            console.log('CryptoCadet: Found checkout button with selector:', selector);
            return el;
          }
        }
        
        console.log('CryptoCadet: No checkout button found');
        return null;
      }

      function extractCartTotal() {
        // Use selectors specific to the cart page total
        const priceSelectors = [
          '.cart-subtotal .money',
          '.cart__subtotal .money', 
          '.cart__total .money',
          '.total-price .money',
          '.order-summary__total .money',
          '.cart-footer__total .money',
          '.cart-subtotal',
          '.cart__subtotal', 
          '.cart__total',
          '.total-price',
          '.order-summary__total',
          '.cart-footer__total',
          '[data-cart-total]',
          '.totals__total'
        ];

        for (const selector of priceSelectors) {
          const priceEl = document.querySelector(selector);
          if (priceEl) {
            let priceText = priceEl.innerText || priceEl.textContent || '';
            priceText = priceText.trim();
            
            console.log('CryptoCadet: Found price element with selector:', selector, 'Text:', priceText);
            
            // Extract just the currency and number using regex
            const priceMatch = priceText.match(/[\\\$£€¥]?\\s*[\\d,]+\\.?\\d*\\s*(?:USD|EUR|GBP|CAD|AUD)?/i);
            if (priceMatch) {
              console.log('CryptoCadet: Extracted price:', priceMatch[0].trim());
              return priceMatch[0].trim();
            }
            
            // Fallback: if regex doesn't work, try to clean manually
            if (priceText.includes('$')) {
              const lines = priceText.split('\\n');
              for (const line of lines) {
                if (line.includes('$') && /\\d/.test(line)) {
                  return line.trim();
                }
              }
            }
          }
        }

        // Final fallback - try data attributes
        const priceDataEl = document.querySelector('[data-cart-total], [data-total-price]');
        if (priceDataEl) {
          const amount = priceDataEl.getAttribute('data-cart-total') || priceDataEl.getAttribute('data-total-price');
          if (amount) {
            return '$' + (parseFloat(amount) / 100).toFixed(2); // Assuming cents
          }
        }

        console.log('CryptoCadet: No price found, using fallback');
        return "$0.00";
      }

      function getCartItems() {
        // Try to extract cart items for better context
        const items = [];
        const itemSelectors = [
          '.cart-item',
          '.cart__item', 
          '.line-item',
          '.cart-product'
        ];
        
        for (const selector of itemSelectors) {
          const itemElements = document.querySelectorAll(selector);
          if (itemElements.length > 0) {
            itemElements.forEach(item => {
              const title = item.querySelector('.cart-item__name, .cart__item-title, .line-item__title, .product-title')?.innerText?.trim();
              const qty = item.querySelector('.cart-item__qty, .qty, .quantity')?.value || item.querySelector('.cart-item__qty, .qty, .quantity')?.innerText;
              if (title) {
                items.push({ title, quantity: qty || 1 });
              }
            });
            break;
          }
        }
        
        return items;
      }

      function addCryptoButton() {
        console.log('CryptoCadet: Attempting to add crypto button');
        
        const existingButton = document.getElementById("crypto-pay-btn");
        if (existingButton) {
          console.log('CryptoCadet: Button already exists');
          return;
        }

        const targetBtn = findTargetButton();
        if (!targetBtn) {
          console.log('CryptoCadet: No target button found');
          return;
        }

        const cryptoBtn = document.createElement("button");
        cryptoBtn.id = "crypto-pay-btn";
        cryptoBtn.type = "button";
        cryptoBtn.textContent = "🚀 Pay with Crypto";
        cryptoBtn.style.cssText = \`
          display: block;
          width: 100%;
          margin-top: 12px;
          margin-bottom: 12px;
          padding: 12px 20px;
          background: #5c6ac4;
          color: #fff;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 16px;
          font-weight: 500;
          transition: background-color 0.2s ease;
        \`;
        
        // Add hover effect
        cryptoBtn.addEventListener('mouseover', function() {
          this.style.backgroundColor = '#4c5ab3';
        });
        
        cryptoBtn.addEventListener('mouseout', function() {
          this.style.backgroundColor = '#5c6ac4';
        });

        cryptoBtn.addEventListener("click", function () {
          const cartTotal = extractCartTotal();
          const cartItems = getCartItems();
          
          console.log('CryptoCadet Debug:', {
            cartTotal,
            cartItems,
            url: window.location.href
          });

          const checkoutData = {
            type: 'cart_checkout',
            total: cartTotal,
            items: cartItems,
            item_count: cartItems.length,
            url: window.location.href,
            timestamp: new Date().toISOString()
          };

          const redirectUrl = "https://shopify.cryptocadet.app/crypto-demo?" +
            new URLSearchParams({ checkout: JSON.stringify(checkoutData) });

          console.log('CryptoCadet: Redirecting to:', redirectUrl);
          window.location.href = redirectUrl;
        });

        // Insert the button before the checkout button
        targetBtn.parentNode.insertBefore(cryptoBtn, targetBtn);
        console.log('CryptoCadet: Crypto button added successfully');
      }

      // Run when DOM is ready
      if (document.readyState === "complete" || document.readyState === "interactive") {
        addCryptoButton();
      } else {
        document.addEventListener("DOMContentLoaded", addCryptoButton);
      }

      // Watch for dynamic cart updates (AJAX cart updates)
      const observer = new MutationObserver(function(mutations) {
        let shouldRun = false;
        mutations.forEach(function(mutation) {
          if (mutation.addedNodes.length > 0) {
            shouldRun = true;
          }
        });
        if (shouldRun) {
          setTimeout(addCryptoButton, 100);
        }
      });
      
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      // Also retry after cart updates (some themes use AJAX)
      setTimeout(addCryptoButton, 1000);
      setTimeout(addCryptoButton, 3000);

    })();
  `);
});
// Payments routes (sessions, confirm, reject)
app.post('/payments/sessions', async (req, res) => {
  try {
    const { gid, amount, currency, test, return_url } = req.body;
    console.log('Creating payment session:', { gid, amount, currency, test });
    if (!gid || !amount || !currency) {
      return res.status(400).json({
        errors: [{ message: 'Missing required fields: gid, amount, currency', code: 'missing_required_fields' }]
      });
    }
    const paymentSession = {
      id: `crypto_session_${Date.now()}`,
      shopify_session_id: gid,
      amount: amount,
      currency: currency,
      test_mode: test || false,
      status: 'pending',
      created_at: new Date().toISOString(),
      return_url: return_url
    };
    console.log('Payment session created:', paymentSession);
    const cryptoPaymentUrl = `${process.env.CRYPTO_APP_URL || 'https://your-crypto-app.com'}/pay/${paymentSession.id}`;
    res.json({
      redirect_url: cryptoPaymentUrl,
      context: { session_id: paymentSession.id, amount: amount, currency: currency }
    });
  } catch (error) {
    console.error('Payment session creation error:', error);
    res.status(422).json({
      errors: [{ message: 'Failed to create payment session', code: 'payment_session_error', details: error.message }]
    });
  }
});

app.post('/payments/confirm', async (req, res) => {
  try {
    const { session_id, transaction_id, crypto_address, amount, block_hash } = req.body;
    console.log('Confirming payment:', { session_id, transaction_id, amount });
    if (!session_id || !transaction_id || !amount) {
      return res.status(400).json({ error: 'Missing required fields: session_id, transaction_id, amount' });
    }
    const confirmationResult = {
      session_id: session_id,
      transaction_id: transaction_id,
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      amount: amount,
      crypto_address: crypto_address,
      block_hash: block_hash
    };
    console.log('Payment confirmed:', confirmationResult);
    res.json({
      success: true,
      transaction_id: transaction_id,
      message: 'Payment confirmed successfully',
      data: confirmationResult
    });
  } catch (error) {
    console.error('Payment confirmation error:', error);
    res.status(500).json({ error: 'Payment confirmation failed', message: error.message });
  }
});

app.post('/payments/reject', async (req, res) => {
  try {
    const { session_id, reason } = req.body;
    console.log('Rejecting payment:', { session_id, reason });
    if (!session_id) {
      return res.status(400).json({ error: 'Missing required field: session_id' });
    }
    const rejectionResult = {
      session_id: session_id,
      status: 'rejected',
      reason: reason || 'Payment failed',
      rejected_at: new Date().toISOString()
    };
    console.log('Payment rejected:', rejectionResult);
    res.json({
      success: true,
      message: 'Payment rejected successfully',
      data: rejectionResult
    });
  } catch (error) {
    console.error('Payment rejection error:', error);
    res.status(500).json({ error: 'Payment rejection failed', message: error.message });
  }
});

// Test checkout endpoint
app.get('/test-checkout', (req, res) => {
  res.send(`... your test checkout HTML ...`);
});

// Webhook endpoints
app.post('/webhooks/orders/create', express.raw({ type: 'application/json' }), (req, res) => {
  console.log('Order created webhook received');
  res.status(200).send('OK');
});

app.post('/webhooks/orders/paid', express.raw({ type: 'application/json' }), (req, res) => {
  console.log('Order paid webhook received');
  res.status(200).send('OK');
});

app.post('/webhooks/orders/cancelled', express.raw({ type: 'application/json' }), (req, res) => {
  console.log('Order cancelled webhook received');
  res.status(200).send('OK');
});

app.post('/webhooks/app/uninstalled', express.raw({ type: 'application/json' }), (req, res) => {
  console.log('App uninstalled webhook received');
  res.status(200).send('OK');
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal error' });
});

// Start
app.listen(PORT, () => {
  console.log(`🚀 CryptoCadet Payment Server running on http://localhost:${PORT}`);
});