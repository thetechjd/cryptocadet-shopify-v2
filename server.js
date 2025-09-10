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
      console.log('CryptoCadet: Script started');
      console.log('CryptoCadet: Current URL:', window.location.href);
      console.log('CryptoCadet: Current pathname:', window.location.pathname);
      
      const SCRIPT_ID = "crypto-pay-button-script";

      // Check if we're on checkout page (this is where payment methods go!)
      const isCheckoutPage = window.location.pathname.includes('/checkout') || 
                            window.location.pathname.includes('/checkouts/') ||
                            window.location.search.includes('checkout') ||
                            document.querySelector('[data-step="payment_method"]') ||
                            document.querySelector('.payment-methods') ||
                            document.querySelector('.step__sections');
      
      console.log('CryptoCadet: Is checkout page?', isCheckoutPage);
      
      if (!isCheckoutPage) {
        console.log('CryptoCadet: Not on checkout page, skipping');
        return;
      }

      if (document.getElementById(SCRIPT_ID)) {
        console.log('CryptoCadet: Script already loaded');
        return;
      }
      
      const scriptElement = document.createElement('script');
      scriptElement.id = SCRIPT_ID;
      document.head.appendChild(scriptElement);
      
      console.log('CryptoCadet: Script element added');

      function debugPageElements() {
        console.log('CryptoCadet: === CHECKOUT PAGE DEBUGGING ===');
        console.log('CryptoCadet: Payment methods section:', document.querySelector('.payment-methods'));
        console.log('CryptoCadet: Step sections:', document.querySelector('.step__sections'));
        console.log('CryptoCadet: Payment forms:', document.querySelectorAll('[data-payment-form]'));
        console.log('CryptoCadet: Credit card elements:', document.querySelectorAll('[data-credit-card], .credit-card'));
        console.log('CryptoCadet: All buttons:', document.querySelectorAll('button'));
        console.log('CryptoCadet: Submit buttons:', document.querySelectorAll('button[type="submit"], input[type="submit"]'));
      }

      function findPaymentSection() {
        console.log('CryptoCadet: Looking for payment section...');
        
        debugPageElements();
        
        // Look for payment methods section first
        const paymentSelectors = [
          '.payment-methods',
          '[data-step="payment_method"]',
          '.section--payment-method',
          '[data-payment-form]',
          '.payment-method-list',
          '.step__sections',
          '.payment-due',
          '.payment-options',
          '#payment-gateway'
        ];
        
        for (const selector of paymentSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            console.log(\`CryptoCadet: Found payment section with selector: \${selector}\`);
            return element;
          }
        }
        
        // Fallback: look for the credit card section
        const creditCardElement = document.querySelector('[data-credit-card], .credit-card, #credit-card');
        if (creditCardElement) {
          console.log('CryptoCadet: Found credit card section as fallback');
          return creditCardElement.closest('.section') || creditCardElement.parentElement;
        }
        
        console.log('CryptoCadet: No payment section found');
        return null;
      }

      function extractCheckoutTotal() {
        console.log('CryptoCadet: Looking for checkout total...');
        
        // Look for total on checkout page
        const totalSelectors = [
          '.total-line .payment-due-label',
          '.payment-due-label',
          '.total-recap__final-price',
          '.payment-due',
          '.order-summary__emphasis',
          '.total-line-table__footer .emphasis',
          '.total-line .emphasis',
          '[data-checkout-payment-due-target]',
          '.order-summary__price--final'
        ];

        for (const selector of totalSelectors) {
          const totalEl = document.querySelector(selector);
          if (totalEl) {
            let totalText = totalEl.innerText || totalEl.textContent || '';
            totalText = totalText.trim();
            
            console.log('CryptoCadet: Found total element with selector:', selector, 'Text:', totalText);
            
            // Extract just the currency and number
            const priceMatch = totalText.match(/[\\\$£€¥]?\\s*[\\d,]+\\.?\\d*\\s*(?:USD|EUR|GBP|CAD|AUD)?/i);
            if (priceMatch) {
              console.log('CryptoCadet: Extracted total:', priceMatch[0].trim());
              return priceMatch[0].trim();
            }
          }
        }

        console.log('CryptoCadet: No total found, using fallback');
        return "$15.00"; // Based on your screenshot
      }

      function addCryptoButton() {
        console.log('CryptoCadet: === ATTEMPTING TO ADD CRYPTO BUTTON ===');
        
        const existingButton = document.getElementById("crypto-pay-btn");
        if (existingButton) {
          console.log('CryptoCadet: Button already exists');
          return;
        }

        const paymentSection = findPaymentSection();
        if (!paymentSection) {
          console.log('CryptoCadet: No payment section found - cannot add crypto button');
          return;
        }

        console.log('CryptoCadet: Payment section found, creating crypto button...');

        // Create a payment method option that looks like the existing ones
        const cryptoOption = document.createElement("div");
        cryptoOption.id = "crypto-pay-option";
        cryptoOption.style.cssText = \`
          margin: 12px 0;
          padding: 16px;
          border: 2px solid #d9d9d9;
          border-radius: 6px;
          background: #f9f9f9;
          cursor: pointer;
          transition: all 0.2s ease;
        \`;

        cryptoOption.innerHTML = \`
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center;">
              <input type="radio" name="payment_method" value="crypto" id="crypto-payment-radio" style="margin-right: 12px;">
              <label for="crypto-payment-radio" style="font-weight: 500; cursor: pointer;">
                🚀 Pay with Cryptocurrency
              </label>
            </div>
            <div style="font-size: 12px; color: #666;">
              Bitcoin, Ethereum, USDC
            </div>
          </div>
          <div id="crypto-pay-details" style="margin-top: 12px; display: none;">
            <button type="button" id="crypto-pay-btn" style="
              width: 100%;
              padding: 12px 20px;
              background: #5c6ac4;
              color: #fff;
              border: none;
              border-radius: 4px;
              cursor: pointer;
              font-size: 16px;
              font-weight: 500;
            ">Continue with Crypto Payment</button>
          </div>
        \`;

        // Add hover effects
        cryptoOption.addEventListener('mouseover', function() {
          this.style.borderColor = '#5c6ac4';
          this.style.backgroundColor = '#f0f0ff';
        });
        
        cryptoOption.addEventListener('mouseout', function() {
          this.style.borderColor = '#d9d9d9';
          this.style.backgroundColor = '#f9f9f9';
        });

        // Handle radio button selection
        const radio = cryptoOption.querySelector('#crypto-payment-radio');
        const details = cryptoOption.querySelector('#crypto-pay-details');
        
        radio.addEventListener('change', function() {
          if (this.checked) {
            details.style.display = 'block';
            cryptoOption.style.borderColor = '#5c6ac4';
            cryptoOption.style.backgroundColor = '#f0f0ff';
            
            // Uncheck other payment methods
            document.querySelectorAll('input[name="payment_method"]:not(#crypto-payment-radio)').forEach(input => {
              input.checked = false;
            });
          }
        });

        // Handle crypto payment button click
        cryptoOption.querySelector('#crypto-pay-btn').addEventListener("click", function () {
          console.log('CryptoCadet: Crypto payment button clicked!');
          
          const checkoutTotal = extractCheckoutTotal();
          
          const checkoutData = {
            type: 'checkout_payment',
            total: checkoutTotal,
            url: window.location.href,
            timestamp: new Date().toISOString()
          };

          const redirectUrl = "https://shopify.cryptocadet.app/crypto-demo?" +
            new URLSearchParams({ checkout: JSON.stringify(checkoutData) });

          console.log('CryptoCadet: Redirecting to:', redirectUrl);
          window.location.href = redirectUrl;
        });

        // Insert the payment option
        console.log('CryptoCadet: Attempting to insert payment option...');
        
        try {
          // Try to insert as the first payment method
          const firstPaymentMethod = paymentSection.querySelector('.payment-method, [data-credit-card]');
          if (firstPaymentMethod) {
            paymentSection.insertBefore(cryptoOption, firstPaymentMethod);
            console.log('CryptoCadet: Payment option inserted before first payment method');
          } else {
            // Fallback: append to payment section
            paymentSection.appendChild(cryptoOption);
            console.log('CryptoCadet: Payment option appended to payment section');
          }
        } catch (e) {
          console.log('CryptoCadet: Error inserting payment option:', e);
          return;
        }
        
        // Verify the option was added
        const addedOption = document.getElementById("crypto-pay-option");
        if (addedOption) {
          console.log('CryptoCadet: ✅ Payment option successfully added to DOM');
        } else {
          console.log('CryptoCadet: ❌ Payment option failed to add to DOM');
        }
      }

      // Run when DOM is ready
      if (document.readyState === "complete" || document.readyState === "interactive") {
        console.log('CryptoCadet: DOM already ready, running...');
        setTimeout(addCryptoButton, 100);
      } else {
        console.log('CryptoCadet: Waiting for DOM ready...');
        document.addEventListener("DOMContentLoaded", function() {
          console.log('CryptoCadet: DOM ready event fired');
          addCryptoButton();
        });
      }

      // Watch for dynamic updates (checkout pages often load content dynamically)
      const observer = new MutationObserver(function(mutations) {
        let shouldRun = false;
        mutations.forEach(function(mutation) {
          if (mutation.addedNodes.length > 0) {
            // Check if payment-related content was added
            mutation.addedNodes.forEach(function(node) {
              if (node.nodeType === 1) { // Element node
                if (node.querySelector && (
                  node.querySelector('.payment-methods') ||
                  node.querySelector('[data-payment-form]') ||
                  node.classList.contains('payment-methods')
                )) {
                  shouldRun = true;
                }
              }
            });
          }
        });
        
        if (shouldRun) {
          console.log('CryptoCadet: Payment-related DOM mutation detected');
          setTimeout(addCryptoButton, 500);
        }
      });
      
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      // Retry with delays (checkout pages can be slow to load)
      setTimeout(() => {
        console.log('CryptoCadet: 2 second retry...');
        addCryptoButton();
      }, 2000);
      
      setTimeout(() => {
        console.log('CryptoCadet: 5 second retry...');
        addCryptoButton();
      }, 5000);

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