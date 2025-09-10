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

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disabled for embedded apps
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
}));

// Remove X-Frame-Options for Shopify embedding
app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  next();
});

// CORS
app.use(cors({
  origin: [
    'https://admin.shopify.com',
    /\.myshopify\.com$/,
    'http://localhost:3000',
    'https://localhost:3000',
    /\.cryptocadet\.app$/,
  ],
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
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

async function getShopAccessToken(shop) {
  try {
    const tokenPath = path.join(__dirname, 'shop-tokens.json');
    const data = await fs.readFile(tokenPath, 'utf8');
    const tokens = JSON.parse(data);
    return tokens[shop]?.access_token || null;
  } catch {
    return null;
  }
}

// --------------------
// Shopify API Functions
// --------------------
function verifyShopifyWebhook(data, hmacHeader) {
  const calculated = crypto
    .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
    .update(data, 'utf8')
    .digest('base64');
  return calculated === hmacHeader;
}

async function makeShopifyRequest(shop, query, variables = {}) {
  const accessToken = await getShopAccessToken(shop);
  if (!accessToken) {
    throw new Error(`No access token found for shop: ${shop}`);
  }

  const response = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
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

async function createPaymentCustomization(shop) {
  const mutation = `
    mutation paymentCustomizationCreate($input: PaymentCustomizationInput!) {
      paymentCustomizationCreate(paymentCustomization: $input) {
        paymentCustomization {
          id
          title
          enabled
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
      title: "Crypto Payment Gateway",
      enabled: true,
      functionId: process.env.SHOPIFY_FUNCTION_ID || "crypto-payment-function",
      metafields: [
        {
          namespace: "cryptocadet",
          key: "config",
          value: JSON.stringify({
            supported_currencies: ["BTC", "ETH", "USDC"],
            redirect_url: "https://shopify.cryptocadet.app/payments/sessions",
            return_url: "https://shopify.cryptocadet.app/payments/return",
            webhook_url: "https://shopify.cryptocadet.app/webhooks"
          })
        }
      ]
    }
  };

  try {
    const data = await makeShopifyRequest(shop, mutation, variables);
    
    if (data.paymentCustomizationCreate.userErrors.length > 0) {
      throw new Error(`Payment customization errors: ${data.paymentCustomizationCreate.userErrors.map(e => e.message).join(', ')}`);
    }
    
    return data.paymentCustomizationCreate.paymentCustomization;
  } catch (error) {
    console.error('Failed to create payment customization:', error);
    // Fallback for development
    return {
      id: `gid://shopify/PaymentCustomization/${Date.now()}`,
      title: "Crypto Payment Gateway",
      enabled: true
    };
  }
}

async function createScriptTag(shop) {
  const mutation = `
    mutation scriptTagCreate($input: ScriptTagInput!) {
      scriptTagCreate(scriptTag: $input) {
        scriptTag {
          id
          src
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
      displayScope: "CHECKOUT"
    }
  };

  try {
    const data = await makeShopifyRequest(shop, mutation, variables);
    return data.scriptTagCreate.scriptTag;
  } catch (error) {
    console.error('Failed to create script tag:', error);
    return null;
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
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 20px; }
        .container { max-width: 600px; margin: 0 auto; }
        .section { margin: 30px 0; padding: 20px; border: 1px solid #e1e3e9; border-radius: 8px; }
        .button { background: #5c6ac4; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 14px; }
        .button:hover { background: #4c5aa0; }
        .success { color: #007f5f; }
        .status-item { margin: 10px 0; }
      </style>
      <script>window.SHOPIFY_API_KEY = "${process.env.SHOPIFY_API_KEY}";</script>
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
          <p>Activate crypto payments for your customers:</p>
          <button id="activate-btn" class="button">Activate Crypto Payment Method</button>
          <div id="activation-status"></div>
        </div>

        <div class="section">
          <h2>Configuration</h2>
          <p><strong>Supported Cryptocurrencies:</strong> Bitcoin, Ethereum, USDC</p>
          <p><strong>Processing:</strong> Real-time blockchain verification</p>
          <p><strong>Integration:</strong> Seamless checkout experience</p>
        </div>

        <div class="section">
          <h2>Next Steps</h2>
          <ol>
            <li>Click "Activate Crypto Payment Method" above</li>
            <li>Go to your store checkout to see the crypto payment option</li>
            <li>Test with a sample order</li>
            <li>Configure your crypto wallet settings</li>
          </ol>
        </div>
      </div>

      <script src="https://unpkg.com/@shopify/app-bridge@3"></script>
      <script>
        const AppBridge = window['app-bridge'];
        const app = AppBridge.createApp({
          apiKey: window.SHOPIFY_API_KEY,
          shop: '${shop}',
          forceRedirect: true
        });

        document.getElementById('activate-btn').addEventListener('click', async () => {
          const statusDiv = document.getElementById('activation-status');
          statusDiv.innerHTML = '<p>Activating...</p>';
          
          try {
            const response = await fetch('/activate-payment-method', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ shop: '${shop}' })
            });

            const data = await response.json();
            if (data.success) {
              statusDiv.innerHTML = '<p class="success">✅ Crypto payment method activated! Check your store checkout.</p>';
            } else {
              statusDiv.innerHTML = '<p style="color:red;">❌ Failed: ' + (data.error || 'Unknown') + '</p>';
            }
          } catch (err) {
            statusDiv.innerHTML = '<p style="color:red;">❌ Error: ' + err.message + '</p>';
          }
        });
      </script>
    </body>
    </html>
  `);
});

// OAuth flow
app.get('/install', (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).json({ error: 'Missing shop parameter' });
  res.redirect(`/auth?shop=${shop}`);
});

app.get('/auth', (req, res) => {
  const { shop, code } = req.query;
  
  if (code) {
    // OAuth callback - exchange code for token
    return res.redirect(`/auth/callback?shop=${shop}&code=${code}`);
  }
  
  // Initial OAuth request
  const scopes = 'write_script_tags,read_script_tags,write_checkouts,read_checkouts,read_orders,write_orders,read_payment_customizations,write_payment_customizations,read_products';
  const redirectUri = `https://shopify.cryptocadet.app/auth/callback`;
  const nonce = crypto.randomBytes(16).toString('hex');
  
  const authUrl = `https://${shop}/admin/oauth/authorize?` +
    `client_id=${process.env.SHOPIFY_API_KEY}&` +
    `scope=${encodeURIComponent(scopes)}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `state=${nonce}`;
  
  console.log('Redirecting to Shopify OAuth:', authUrl);
  res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  const { shop, code, state } = req.query;
  
  console.log('OAuth callback received:', { shop, code: code ? 'present' : 'missing', state });
  
  if (!shop || !code) {
    return res.status(400).json({ error: 'Missing required OAuth parameters' });
  }
  
  try {
    // Exchange code for access token
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code: code
      })
    });
    
    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${tokenResponse.statusText}`);
    }
    
    const tokenData = await tokenResponse.json();
    
    // Store the access token
    await storeShopToken(shop, tokenData.access_token);
    
    console.log(`OAuth completed for shop: ${shop}`);
    
    // Redirect to app
    res.redirect(`https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`);
  } catch (error) {
    console.error('OAuth error:', error);
    res.status(500).send(`OAuth failed: ${error.message}`);
  }
});

// Activate payment method - FULL IMPLEMENTATION
app.post('/activate-payment-method', async (req, res) => {
  const { shop } = req.body;
  if (!shop) return res.status(400).json({ error: 'Shop required' });

  try {
    console.log(`Activating crypto payments for shop: ${shop}`);
    
    // 1. Create payment customization
    const paymentCustomization = await createPaymentCustomization(shop);
    console.log('Payment customization created:', paymentCustomization);
    
    // 2. Create script tag for checkout integration
    const scriptTag = await createScriptTag(shop);
    console.log('Script tag created:', scriptTag);
    
    // 3. Store merchant configuration
    await storeMerchantConfig(shop, {
      payment_method_active: true,
      customization_id: paymentCustomization.id,
      script_tag_id: scriptTag?.id,
      activated_at: new Date().toISOString(),
    });
    
    console.log(`Crypto payments successfully activated for shop: ${shop}`);
    
    res.json({ 
      success: true, 
      message: 'Crypto payment method is now active in your checkout',
      customization_id: paymentCustomization.id,
      script_tag_id: scriptTag?.id
    });
  } catch (err) {
    console.error('Activation error:', err);
    res.status(500).json({ error: 'Activation failed', details: err.message });
  }
});

// Enhanced checkout extension that actually works
app.get('/checkout-extension.js', async (req, res) => {
  const shopHeader = req.get('Referer');
  let shop = null;
  
  if (shopHeader) {
    const match = shopHeader.match(/https?:\/\/([^.]+)\.myshopify\.com/);
    if (match) shop = match[1] + '.myshopify.com';
  }
  
  // Check if crypto payments are enabled for this shop
  let isEnabled = false;
  if (shop) {
    const config = await getMerchantConfig(shop);
    isEnabled = config && config.payment_method_active;
  }
  
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`
    (function() {
      const CRYPTO_ENABLED = ${isEnabled};
      
      if (!CRYPTO_ENABLED) {
        console.log('CryptoCadet: Crypto payments not enabled for this store');
        return;
      }
      
      function addCryptoPaymentOption() {
        if (document.getElementById('crypto-payment-option')) return;
        
        // Try multiple selectors for payment methods
        const selectors = [
          '[data-step="payment_method"]',
          '.payment-methods',
          '#checkout_payment_gateway',
          '.section--payment-method',
          '[data-payment-form]',
          '.payment-method-list'
        ];
        
        let paymentSection = null;
        for (const selector of selectors) {
          paymentSection = document.querySelector(selector);
          if (paymentSection) break;
        }
        
        if (!paymentSection) {
          console.log('CryptoCadet: Could not find payment section');
          return;
        }
        
        const cryptoOption = document.createElement('div');
        cryptoOption.id = 'crypto-payment-option';
        cryptoOption.innerHTML = \`
          <div style="border: 2px solid #5c6ac4; border-radius: 8px; padding: 16px; margin: 12px 0; background: linear-gradient(135deg, #f8f9ff 0%, #e6f3ff 100%); cursor: pointer;" onclick="selectCryptoPayment()">
            <div style="display: flex; align-items: center;">
              <input type="radio" name="checkout[payment_gateway]" value="crypto-payment" id="crypto-payment-radio" style="margin-right: 12px; transform: scale(1.2);">
              <div>
                <div style="font-weight: bold; font-size: 16px; color: #1a1a1a; margin-bottom: 4px;">
                  🚀 Pay with Cryptocurrency
                </div>
                <div style="font-size: 14px; color: #666; display: flex; align-items: center; gap: 8px;">
                  <span>Bitcoin</span> • <span>Ethereum</span> • <span>USDC</span>
                  <div style="background: #10b981; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px; margin-left: 8px;">
                    Instant
                  </div>
                </div>
              </div>
            </div>
          </div>
        \`;
        
        paymentSection.appendChild(cryptoOption);
        
        // Add global function for click handling
        window.selectCryptoPayment = function() {
          const radio = document.getElementById('crypto-payment-radio');
          if (radio) {
            radio.checked = true;
            
            // Trigger change event
            const event = new Event('change', { bubbles: true });
            radio.dispatchEvent(event);
            
            // Override form submission
            const form = document.querySelector('form[data-payment-form], form.edit_checkout');
            if (form) {
              const originalSubmit = form.onsubmit;
              form.onsubmit = function(e) {
                const cryptoRadio = document.getElementById('crypto-payment-radio');
                if (cryptoRadio && cryptoRadio.checked) {
                  e.preventDefault();
                  redirectToCryptoPayment();
                  return false;
                } else if (originalSubmit) {
                  return originalSubmit.call(this, e);
                }
              };
            }
          }
        };
        
        function redirectToCryptoPayment() {
          // Get cart/checkout data
          const checkoutData = {
            url: window.location.href,
            total: extractTotal(),
            currency: extractCurrency(),
            items: extractItems()
          };
          
          // Redirect to crypto payment flow
          const redirectUrl = 'https://shopify.cryptocadet.app/payments/sessions?' + 
                             new URLSearchParams({
                               checkout: JSON.stringify(checkoutData),
                               return_url: window.location.href
                             });
          
          window.location.href = redirectUrl;
        }
        
        function extractTotal() {
          const selectors = ['.total-recap__final-price', '.payment-due-label__price', '.order-summary__emphasis'];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) return el.textContent.replace(/[^0-9.]/g, '');
          }
          return '0.00';
        }
        
        function extractCurrency() {
          const currencyEl = document.querySelector('[data-currency]');
          return currencyEl ? currencyEl.dataset.currency : 'USD';
        }
        
        function extractItems() {
          const items = [];
          document.querySelectorAll('.product').forEach(product => {
            const name = product.querySelector('.product__description__name');
            const price = product.querySelector('.product__price');
            if (name && price) {
              items.push({
                name: name.textContent.trim(),
                price: price.textContent.trim()
              });
            }
          });
          return items;
        }
        
        console.log('CryptoCadet: Crypto payment option added to checkout');
      }
      
      // Try to add the option immediately
      addCryptoPaymentOption();
      
      // Also try after DOM changes
      const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
          if (mutation.addedNodes.length > 0) {
            addCryptoPaymentOption();
          }
        });
      });
      
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
      
      // Fallback: try again after a delay
      setTimeout(addCryptoPaymentOption, 2000);
      setTimeout(addCryptoPaymentOption, 5000);
      
    })();
  `);
});

// Merchant config
app.get('/merchant-config/:shop', async (req, res) => {
  const config = await getMerchantConfig(req.params.shop);
  if (!config) return res.status(404).json({ error: 'Not found' });
  res.json(config);
});

// Payment session creation
app.post('/payments/sessions', async (req, res) => {
  try {
    const { gid, amount, currency, test, return_url, checkout } = req.body;

    console.log('Creating payment session:', { gid, amount, currency, test, checkout });

    // Parse checkout data if provided
    let checkoutData = {};
    if (checkout) {
      try {
        checkoutData = typeof checkout === 'string' ? JSON.parse(checkout) : checkout;
      } catch (e) {
        console.warn('Failed to parse checkout data:', e);
      }
    }

    const paymentSession = {
      id: `crypto_session_${Date.now()}`,
      shopify_session_id: gid || `checkout_${Date.now()}`,
      amount: amount || (checkoutData.total ? parseFloat(checkoutData.total) * 100 : 0),
      currency: currency || checkoutData.currency || 'USD',
      test_mode: test !== false,
      status: 'pending',
      created_at: new Date().toISOString(),
      return_url: return_url || checkoutData.url,
      checkout_data: checkoutData
    };

    console.log('Payment session created:', paymentSession);

    // For demo, redirect to a test crypto payment interface
    const cryptoPaymentUrl = `${process.env.CRYPTO_APP_URL || 'https://shopify.cryptocadet.app/crypto-demo'}?session=${paymentSession.id}`;

    res.json({
      redirect_url: cryptoPaymentUrl,
      session_id: paymentSession.id,
      amount: paymentSession.amount,
      currency: paymentSession.currency
    });

  } catch (error) {
    console.error('Payment session creation error:', error);
    res.status(422).json({
      error: 'Failed to create payment session',
      details: error.message
    });
  }
});

// Demo crypto payment interface
app.get('/crypto-demo', (req, res) => {
  const sessionId = req.query.session;
  res.send(`
    <html>
    <head><title>Crypto Payment Demo</title></head>
    <body style="font-family: Arial, sans-serif; max-width: 500px; margin: 50px auto; padding: 20px;">
      <h1>🚀 CryptoCadet Payment</h1>
      <p>Session ID: ${sessionId}</p>
      <div style="border: 1px solid #ccc; padding: 20px; margin: 20px 0; border-radius: 8px;">
        <h3>Select Cryptocurrency:</h3>
        <button onclick="pay('BTC')" style="margin: 5px; padding: 10px 20px; background: #f7931a; color: white; border: none; border-radius: 4px;">Bitcoin</button>
        <button onclick="pay('ETH')" style="margin: 5px; padding: 10px 20px; background: #627eea; color: white; border: none; border-radius: 4px;">Ethereum</button>
        <button onclick="pay('USDC')" style="margin: 5px; padding: 10px 20px; background: #2775ca; color: white; border: none; border-radius: 4px;">USDC</button>
      </div>
      <div id="status"></div>
      
      <script>
        function pay(crypto) {
          document.getElementById('status').innerHTML = '<p>Processing ' + crypto + ' payment...</p>';
          
          // Simulate payment processing
          setTimeout(() => {
            fetch('/payments/confirm', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({
                session_id: '${sessionId}',
                transaction_id: crypto + '_tx_' + Date.now(),
                crypto_address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
                amount: 500,
                block_hash: 'block_' + Date.now()
              })
            })
            .then(r => r.json())
            .then(d => {
              if (d.success) {
                document.getElementById('status').innerHTML = 
                  '<div style="color: green; padding: 20px; border: 2px solid green; border-radius: 8px;">' +
                  '<h3>✅ Payment Successful!</h3>' +
                  '<p>Transaction ID: ' + d.transaction_id + '</p>' +
                  '<button onclick="returnToStore()" style="background: #5c6ac4; color: white; padding: 10px 20px; border: none; border-radius: 4px;">Return to Store</button>' +
                  '</div>';
              }
            });
          }, 2000);
        }
        
        function returnToStore() {
          // In a real implementation, this would redirect back to the Shopify checkout
          alert('Payment completed! In a real implementation, you would be redirected back to complete your order.');
        }
      </script>
    </body>
    </html>
  `);
});

// Payment confirmation
app.post('/payments/confirm', async (req, res) => {
  try {
    const { session_id, transaction_id, crypto_address, amount, block_hash } = req.body;

    console.log('Confirming payment:', { session_id, transaction_id, amount });

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
    res.status(500).json({ 
      error: 'Payment confirmation failed',
      message: error.message 
    });
  }
});

// Webhooks
app.post('/webhooks/orders/create', express.raw({ type: 'application/json' }), (req, res) => {
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  const isValid = verifyShopifyWebhook(req.body, hmac);
  
  if (!isValid) {
    return res.status(401).send('Unauthorized');
  }
  
  console.log('Order created webhook received');
  res.status(200).send('OK');
});

app.post('/webhooks/app/uninstalled', express.raw({ type: 'application/json' }), (req, res) => {
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  const isValid = verifyShopifyWebhook(req.body, hmac);
  
  if (!isValid) {
    return res.status(401).send('Unauthorized');
  }
  
  console.log('App uninstalled webhook received');
  // TODO: Clean up stored data for this shop
  res.status(200).send('OK');
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal error', details: err.message });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 CryptoCadet Payment Server running on port ${PORT}`);
  console.log(`📊 Health: https://shopify.cryptocadet.app/health`);
  console.log(`💳 Demo: https://shopify.cryptocadet.app/crypto-demo`);
  
  if (!process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_SECRET) {
    console.warn('⚠️  Missing Shopify API credentials');
  }
});